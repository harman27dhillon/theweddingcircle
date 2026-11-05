export const CORE_TABLES = ["circles", "circle_members", "circle_auth", "ceremony_invites", "couple_access"] as const;

export type CoreTable = (typeof CORE_TABLES)[number];

/** Supabase wedding schema. RLS stays on with no public policies. */
export const SUPABASE_CORE_SQL = `
create table if not exists public.circles (
  slug text primary key,
  payload jsonb not null,
  edit_key text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.circle_members (
  slug text not null,
  member_key text not null,
  email text not null default '',
  name text not null default '',
  role text not null,
  primary key (slug, member_key)
);
create table if not exists public.circle_auth (
  slug text primary key,
  host_code text not null,
  cohost_code text not null,
  family_codes text not null,
  guest_codes text not null,
  edit_key text not null
);
create table if not exists public.ceremony_invites (
  token text primary key,
  slug text not null,
  code_kind text not null,
  code_id text not null,
  ceremonies jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create table if not exists public.couple_access (
  slug text primary key,
  bride_code text not null default '',
  bride_status text not null default '',
  bride_claimed text not null default '',
  bride_account text not null default '',
  bride_name text not null default '',
  groom_code text not null default '',
  groom_status text not null default '',
  groom_claimed text not null default '',
  groom_account text not null default '',
  groom_name text not null default ''
);
create index if not exists circle_members_slug_idx on public.circle_members (slug);
create index if not exists ceremony_invites_slug_idx on public.ceremony_invites (slug);
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.circle_auth enable row level security;
alter table public.ceremony_invites enable row level security;
alter table public.couple_access enable row level security;
revoke all on table public.circles from anon, authenticated, public;
revoke all on table public.circle_members from anon, authenticated, public;
revoke all on table public.circle_auth from anon, authenticated, public;
revoke all on table public.ceremony_invites from anon, authenticated, public;
revoke all on table public.couple_access from anon, authenticated, public;
create table if not exists public.wedding_core_recovery (
  id text primary key,
  table_name text not null,
  row_key text not null,
  reason text not null,
  row_data jsonb not null,
  captured_at timestamptz not null default now()
);
alter table public.wedding_core_recovery enable row level security;
revoke all on table public.wedding_core_recovery from anon, authenticated, public;
`;

/** Single statements. Applied only on Supabase, after the tables exist. Duplicate names are ignored. */
export const SUPABASE_CORE_CONSTRAINTS = [
  "alter table public.circle_members add constraint circle_members_slug_fkey foreign key (slug) references public.circles (slug)",
  "alter table public.circle_auth add constraint circle_auth_slug_fkey foreign key (slug) references public.circles (slug)",
  "alter table public.ceremony_invites add constraint ceremony_invites_slug_fkey foreign key (slug) references public.circles (slug)",
  "alter table public.couple_access add constraint couple_access_slug_fkey foreign key (slug) references public.circles (slug)",
] as const;

export const CORE_COLUMNS: Record<CoreTable, readonly string[]> = {
  circles: ["slug", "payload", "edit_key", "updated_at"],
  circle_members: ["slug", "member_key", "email", "name", "role"],
  circle_auth: ["slug", "host_code", "cohost_code", "family_codes", "guest_codes", "edit_key"],
  ceremony_invites: ["token", "slug", "code_kind", "code_id", "ceremonies", "created_at", "expires_at", "revoked_at"],
  couple_access: [
    "slug",
    "bride_code",
    "bride_status",
    "bride_claimed",
    "bride_account",
    "bride_name",
    "groom_code",
    "groom_status",
    "groom_claimed",
    "groom_account",
    "groom_name",
  ],
};

export const CORE_PRIMARY_KEYS: Record<CoreTable, readonly string[]> = {
  circles: ["slug"],
  circle_members: ["slug", "member_key"],
  circle_auth: ["slug"],
  ceremony_invites: ["token"],
  couple_access: ["slug"],
};

const JSON_COLUMNS = new Set(["payload", "ceremonies"]);

/**
 * All persistent application tables are hosted in Supabase. PGLite is a disposable local preview only.
 */
export const SCHEMA_INVENTORY = [
  { name: "circles", current: "supabase", intended: "supabase", kind: "table", holds: "Wedding record, including chat, posts and notes inside payload" },
  { name: "circle_members", current: "supabase", intended: "supabase", kind: "table", holds: "Membership rows" },
  { name: "circle_auth", current: "supabase", intended: "supabase", kind: "table", holds: "Host, family and guest access codes" },
  { name: "ceremony_invites", current: "supabase", intended: "supabase", kind: "table", holds: "Ceremony invitation tokens" },
  { name: "couple_access", current: "supabase", intended: "supabase", kind: "table", holds: "Bride and groom seat codes" },
  { name: "circle_live", current: "supabase", intended: "supabase", kind: "table", holds: "Ephemeral live-room presence. Not part of this cutover." },
  { name: "circle_live_signal", current: "supabase", intended: "supabase", kind: "table", holds: "Ephemeral live signaling. Not part of this cutover." },
  { name: "circle_media", current: "supabase", intended: "supabase", kind: "table", holds: "Media metadata and storage pointer. Bytes stay on current storage." },
  { name: "circle_media_part", current: "supabase", intended: "supabase", kind: "table", holds: "Media bytes stored as text chunks" },
  { name: "circle_media_remote", current: "supabase", intended: "supabase", kind: "table", holds: "Remote media chunk sizes" },
  { name: "library_assets", current: "supabase", intended: "supabase", kind: "table", holds: "Library file metadata" },
  { name: "library_blobs", current: "supabase", intended: "supabase", kind: "table", holds: "Library file bytes" },
  { name: "library_retired", current: "supabase", intended: "supabase", kind: "table", holds: "Retired library ids" },
  { name: "google_connections", current: "supabase", intended: "supabase", kind: "table", holds: "Google Drive account link. Contains a refresh token." },
  { name: "google_media", current: "supabase", intended: "supabase", kind: "table", holds: "Google Drive file ids, not file bytes" },
  { name: "google_uploads", current: "supabase", intended: "supabase", kind: "table", holds: "In-progress Google upload URLs" },
  { name: "google_app", current: "supabase", intended: "supabase", kind: "table", holds: "Google OAuth client secret" },
  { name: "user", current: "supabase", intended: "supabase", kind: "table", holds: "Better Auth account" },
  { name: "session", current: "supabase", intended: "supabase", kind: "table", holds: "Better Auth browser session" },
  { name: "account", current: "supabase", intended: "supabase", kind: "table", holds: "Better Auth provider link" },
  { name: "verification", current: "supabase", intended: "supabase", kind: "table", holds: "Better Auth verification token" },
  { name: "developer_sessions", current: "supabase", intended: "supabase", kind: "table", holds: "Developer console session" },
  { name: "developer_audit", current: "supabase", intended: "supabase", kind: "table", holds: "Developer audit log" },
  { name: "developer_flags", current: "supabase", intended: "supabase", kind: "table", holds: "Developer flags" },
  { name: "developer_config", current: "supabase", intended: "supabase", kind: "table", holds: "Developer config" },
  { name: "developer_errors", current: "supabase", intended: "supabase", kind: "table", holds: "Developer error log" },
  { name: "developer_proposals", current: "supabase", intended: "supabase", kind: "table", holds: "Developer proposals" },
  { name: "developer_revisions", current: "supabase", intended: "supabase", kind: "table", holds: "Developer file revisions" },
  { name: "developer_cloud_public", current: "supabase", intended: "supabase", kind: "table", holds: "Public cloud config" },
  { name: "developer_cloud_tests", current: "supabase", intended: "supabase", kind: "table", holds: "Cloud connection tests" },
  { name: "developer_cloud_requests", current: "supabase", intended: "supabase", kind: "table", holds: "Cloud choice requests" },
  { name: "developer_cloud_active", current: "supabase", intended: "supabase", kind: "table", holds: "Active cloud choices" },
  { name: "developer_secret_vault", current: "supabase", intended: "supabase", kind: "table", holds: "Encrypted affiliate secrets" },
  { name: "developer_core_migration", current: "supabase", intended: "supabase", kind: "table", holds: "Cutover flag. Must stay on Neon so routing can be read before Supabase is used." },
  { name: "push_devices", current: "supabase", intended: "supabase", kind: "table", holds: "Push device tokens" },
  { name: "discover_bots", current: "supabase", intended: "supabase", kind: "table", holds: "Discover crawler config" },
  { name: "discover_runs", current: "supabase", intended: "supabase", kind: "table", holds: "Discover run history" },
  { name: "discover_products", current: "supabase", intended: "supabase", kind: "table", holds: "Discover product rows" },
  { name: "affiliate_link_status", current: "supabase", intended: "supabase", kind: "table", holds: "Affiliate link status" },
  { name: "_migrations", current: "supabase", intended: "supabase", kind: "table", holds: "Applied Neon migration names" },
] as const;

export const FEATURE_PATHS = [
  { feature: "sign-in", storage: "supabase", tables: ["user", "account"] },
  { feature: "account-session", storage: "supabase", tables: ["session"] },
  { feature: "create-wedding", storage: "wedding-data", tables: ["circles", "circle_auth", "circle_members"] },
  { feature: "join-guest-or-family", storage: "wedding-data", tables: ["circle_auth", "circle_members"] },
  { feature: "membership", storage: "wedding-data", tables: ["circle_members"] },
  { feature: "access-code", storage: "wedding-data", tables: ["circle_auth"] },
  { feature: "invitation", storage: "wedding-data", tables: ["ceremony_invites"] },
  { feature: "couple-permission", storage: "wedding-data", tables: ["couple_access", "circles"] },
  { feature: "chat", storage: "wedding-data", tables: ["circles"] },
  { feature: "media-reference", storage: "supabase", tables: ["circle_media", "google_media"] },
  { feature: "media-bytes", storage: "supabase", tables: ["circle_media_part", "library_blobs"] },
  { feature: "live-room", storage: "supabase", tables: ["circle_live", "circle_live_signal"] },
  { feature: "live-membership-check", storage: "wedding-data", tables: ["circle_members"] },
] as const;

export const AUTH_NOTE =
  "Wedding access codes, Better Auth accounts, and sessions use the configured Supabase Postgres database. No cross-database copy is performed.";

export const MEDIA_NOTE =
  "Photos and videos stay in the current library. This migration copies their existing URLs inside the wedding record and does not copy file bytes or change those URLs.";

export const SETUP_NOTE =
  "Supabase Postgres reads only SUPABASE_DB_URL, exactly as stored. The server does not rewrite the username or decode the password a second time. Use the generated session-pooler URI. Do not paste it into this page or into chat.";

export const ROLLBACK_NOTE =
  "Supabase is the sole persistent database. There is no secondary database rollback route.";

export function writesPaused(phase: string) {
  return phase === "frozen" || phase === "reverse_verified" || phase === "syncing";
}

export function isMutationStatement(text: string) {
  return /^\s*(insert|update|delete|truncate)\b/i.test(text);
}

export function compareCounts(source: Record<string, number>, target: Record<string, number>, targetReachable = true) {
  const rows = CORE_TABLES.map((table) => {
    const sourceCount = source[table] ?? 0;
    const targetCount = target[table] ?? 0;
    const match = targetReachable && sourceCount >= 0 && targetCount >= 0 && sourceCount === targetCount;
    return { table, source: sourceCount, target: targetCount, match };
  });
  return { rows, ok: targetReachable && rows.every((row) => row.match) };
}

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function canonicalField(column: string, value: unknown) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (JSON_COLUMNS.has(column)) {
    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      return stableJson(parsed);
    } catch {
      return JSON.stringify(value);
    }
  }
  if (typeof value === "string" && /_at$/.test(column)) {
    const time = Date.parse(value);
    if (!Number.isNaN(time)) return new Date(time).toISOString();
  }
  return String(value);
}

export type FieldDiff = {
  table: CoreTable;
  key: string;
  column: string;
  kind: "missing_on_target" | "extra_on_target" | "value";
};

export function coreRowKey(table: CoreTable, row: Record<string, unknown>) {
  return CORE_PRIMARY_KEYS[table].map((key) => canonicalField(key, row[key]) ?? "").join("\u0000");
}

const SECRET_COLUMNS = new Set([
  "edit_key",
  "host_code",
  "cohost_code",
  "family_codes",
  "guest_codes",
  "bride_code",
  "groom_code",
  "bride_claimed",
  "groom_claimed",
  "bride_account",
  "groom_account",
]);

function shortHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Safe to show on the migration desk. Tokens and member keys are not returned raw. */
export function publicRecordKey(table: CoreTable, key: string) {
  const parts = key.split("\u0000");
  if (table === "circle_members") return `${(parts[0] || "wedding").slice(0, 80)}:${shortHash(parts[1] || "")}`;
  if (table === "ceremony_invites") return `invite:${shortHash(parts[0] || "")}`;
  return (parts[0] || "row").slice(0, 80);
}

export function describeFieldDiffs(diffs: FieldDiff[]) {
  return diffs.slice(0, 40).map((diff) => ({
    table: diff.table,
    key: publicRecordKey(diff.table, diff.key),
    column: SECRET_COLUMNS.has(diff.column) ? "credential" : diff.column,
    kind: diff.kind,
  }));
}

export function compareCoreRows(
  table: CoreTable,
  source: Record<string, unknown>[],
  target: Record<string, unknown>[],
) {
  const keys = CORE_PRIMARY_KEYS[table];
  const columns = CORE_COLUMNS[table];
  const keyOf = (row: Record<string, unknown>) => coreRowKey(table, row);
  const sourceMap = new Map(source.map((row) => [keyOf(row), row]));
  const targetMap = new Map(target.map((row) => [keyOf(row), row]));
  const diffs: FieldDiff[] = [];
  for (const [key, row] of sourceMap) {
    const other = targetMap.get(key);
    if (!other) {
      diffs.push({ table, key, column: keys.join(","), kind: "missing_on_target" });
      continue;
    }
    for (const column of columns) {
      if (canonicalField(column, row[column]) !== canonicalField(column, other[column])) {
        diffs.push({ table, key, column, kind: "value" });
      }
    }
  }
  for (const key of targetMap.keys()) {
    if (!sourceMap.has(key)) diffs.push({ table, key, column: keys.join(","), kind: "extra_on_target" });
  }
  return { ok: diffs.length === 0, diffs };
}

export function upsertConflict(table: CoreTable, columns: string[], mode: "forward" | "reverse") {
  const keys = CORE_PRIMARY_KEYS[table];
  const updates = columns.filter((column) => !keys.includes(column));
  if (!updates.length) return `on conflict (${keys.join(", ")}) do nothing`;
  const assignments = updates.map((column) => `${column} = excluded.${column}`).join(", ");
  if (mode === "forward" && table === "circles" && columns.includes("updated_at")) {
    return `on conflict (${keys.join(", ")}) do update set ${assignments} where public.circles.updated_at is null or public.circles.updated_at <= excluded.updated_at`;
  }
  return `on conflict (${keys.join(", ")}) do update set ${assignments}`;
}

export function decideCoreCutover(input: {
  confirm: boolean;
  validated: boolean;
  countsMatch: boolean;
  fieldCompareOk: boolean;
  dbUrlConfigured: boolean;
  duplicateIds: number;
  orphanInvites: number;
}) {
  if (!input.confirm) return { ok: false as const, error: "Cutover stays off until you confirm it. The current database is still serving wedding data." };
  if (!input.dbUrlConfigured) return { ok: false as const, error: "SUPABASE_DB_URL is not set on the server. Wedding traffic stays on the current database." };
  if (!input.validated || !input.countsMatch) return { ok: false as const, error: "Validation has not passed. Wedding traffic stays on the current database." };
  if (!input.fieldCompareOk) return { ok: false as const, error: "Field compare has not passed. Matching counts is not enough. Wedding traffic stays on the current database." };
  if (input.duplicateIds > 0) return { ok: false as const, error: "Duplicate chat ids were found. Wedding traffic stays on the current database." };
  if (input.orphanInvites > 0) return { ok: false as const, error: "Some ceremony invitations point at a missing wedding. Wedding traffic stays on the current database." };
  return { ok: true as const };
}

export function decideRollback(input: { confirm: boolean; cutover: string; frozen: boolean; reverseVerified: boolean; fieldCompareOk: boolean }) {
  if (!input.confirm) return { ok: false as const, error: "Rollback stays off until you confirm it. Neither database will be deleted." };
  if (input.cutover !== "supabase") return { ok: false as const, error: "Wedding traffic is already on the current database. Nothing was switched." };
  if (!input.frozen) return { ok: false as const, error: "Rollback stays off until wedding writes are paused. Switching now would hide rows written on Supabase." };
  if (!input.reverseVerified || !input.fieldCompareOk) return { ok: false as const, error: "Rollback stays off until the reverse sync matches every core field. Nothing was switched." };
  return { ok: true as const };
}

export function decideUnfreeze(input: { confirm: boolean; phase: string }) {
  if (!input.confirm) return { ok: false as const, error: "Writes stay paused until you confirm they can resume." };
  if (!writesPaused(input.phase)) return { ok: false as const, error: "Wedding writes are not paused. Nothing was changed." };
  return { ok: true as const };
}

export function reviewRls(input: { tables: { name: string; rls: boolean }[]; policies: { table: string; roles: string }[] }) {
  const problems: string[] = [];
  for (const table of CORE_TABLES) {
    const row = input.tables.find((item) => item.name === table);
    if (!row) problems.push(`${table} is missing, so its access policy was not verified.`);
    else if (!row.rls) problems.push(`${table} does not have row level security enabled.`);
  }
  for (const policy of input.policies) {
    if ((CORE_TABLES as readonly string[]).includes(policy.table)) problems.push(`${policy.table} has a policy for ${policy.roles}. Public policies are not allowed.`);
  }
  return { ok: problems.length === 0, problems };
}

/** The server role must not be anon, authenticated, or public, and it must be able to read and write every core table. */
export function reviewServerAccess(input: {
  role: string;
  tables: { table: string; select: boolean; insert: boolean; update: boolean; delete: boolean }[];
}) {
  const problems: string[] = [];
  const role = input.role.trim().toLowerCase();
  if (!role || role === "anon" || role === "authenticated" || role === "public") {
    problems.push("The server connection is not a privileged database role.");
  }
  for (const table of CORE_TABLES) {
    const row = input.tables.find((item) => item.table === table);
    if (!row || !row.select || !row.insert || !row.update || !row.delete) {
      problems.push(`${table} is not fully available to the server connection.`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** anon, authenticated, and public must not hold grants on wedding tables. */
export function reviewGrants(rows: { table: string; grantee: string; privilege: string }[]) {
  const problems: string[] = [];
  for (const row of rows) {
    if (!(CORE_TABLES as readonly string[]).includes(row.table)) continue;
    const grantee = row.grantee.toLowerCase();
    if (grantee === "anon" || grantee === "authenticated" || grantee === "public") {
      problems.push(`${row.table} grants ${row.privilege} to ${row.grantee}.`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Rolled-back and in-progress reverse sync stay put. Everything else may reconcile. */
export function shouldAutoActivate(cutover: string, phase: string) {
  if (cutover === "supabase") return false;
  if (phase === "rolled_back" || phase === "frozen" || phase === "reverse_verified") return false;
  return true;
}

export function chooseWeddingRoute(input: { production: boolean; supabaseConfigured: boolean; supabaseOpen: boolean }) {
  if (input.supabaseConfigured && input.supabaseOpen) {
    return { use: "supabase" as const, reason: "Persistent application data uses Supabase Postgres." };
  }
  if (!input.production && !input.supabaseConfigured) {
    return { use: "preview" as const, reason: "Local preview uses disposable PGLite." };
  }
  return { use: "refuse" as const, reason: "Supabase is unavailable or not configured. No fallback database will be used." };
}

export function schemaLooksSafe(sql: string) {
  const lowered = sql.toLowerCase();
  const banned = ["password", "session", "circle_media_part", "library_blobs", "service_role", "drop table", "delete from"];
  return banned.every((word) => !lowered.includes(word));
}
