import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pendingMigrations } from "../../../scripts/migration-plan.mjs";
import {
  CORE_TABLES,
  FEATURE_PATHS,
  SCHEMA_INVENTORY,
  SUPABASE_CORE_CONSTRAINTS,
  SUPABASE_CORE_SQL,
  compareCoreRows,
  compareCounts,
  decideCoreCutover,
  decideRollback,
  decideUnfreeze,
  describeFieldDiffs,
  isMutationStatement,
  reviewGrants,
  reviewRls,
  reviewServerAccess,
  schemaLooksSafe,
  shouldAutoActivate,
  upsertConflict,
  writesPaused,
  chooseWeddingRoute,
} from "./core-migration.ts";

const baseCutover = {
  confirm: true,
  validated: true,
  countsMatch: true,
  fieldCompareOk: true,
  dbUrlConfigured: true,
  duplicateIds: 0,
  orphanInvites: 0,
};

test("supabase schema does not copy passwords, sessions or media bytes", () => {
  assert.equal(schemaLooksSafe(SUPABASE_CORE_SQL), true);
  assert.equal(schemaLooksSafe(SUPABASE_CORE_CONSTRAINTS.join("\n")), true);
  assert.match(SUPABASE_CORE_SQL, /create table if not exists public\.circles/i);
  assert.match(SUPABASE_CORE_SQL, /enable row level security/i);
  assert.match(SUPABASE_CORE_SQL, /revoke all on table public\.circles from anon, authenticated, public/i);
  assert.doesNotMatch(SUPABASE_CORE_SQL, /circle_media_part|library_blobs|password|session/i);
});

test("Supabase additive schema is maintained separately from root migrations", () => {
  const root = join(process.cwd(), "migrations");
  const top = readdirSync(root);
  assert.equal(top.includes("0017_wedding_core_additive.sql"), false);
  assert.equal(pendingMigrations(top, []).some((item) => item.name.includes("0017_wedding_core")), false);
  const file = readFileSync(join(root, "supabase", "0017_wedding_core_additive.sql"), "utf8");
  for (const statement of SUPABASE_CORE_CONSTRAINTS) assert.match(file, new RegExp(statement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(file, /revoke all on table public\.couple_access/i);
  assert.match(file, /wedding_core_recovery/);
  assert.match(SUPABASE_CORE_SQL, /wedding_core_recovery/);
  assert.doesNotMatch(file, /drop table|delete from/i);
  assert.equal(statSync(join(root, "supabase")).isDirectory(), true);
});

test("cutover stays off until validation, a field compare, a database url, and explicit confirmation", () => {
  assert.equal(decideCoreCutover({ ...baseCutover, confirm: false }).ok, false);
  assert.equal(decideCoreCutover({ ...baseCutover, validated: false }).ok, false);
  assert.equal(decideCoreCutover({ ...baseCutover, dbUrlConfigured: false }).ok, false);
  assert.equal(decideCoreCutover({ ...baseCutover, fieldCompareOk: false }).ok, false);
  assert.equal(decideCoreCutover({ ...baseCutover, duplicateIds: 2 }).ok, false);
  assert.equal(decideCoreCutover(baseCutover).ok, true);
});

test("rollback cannot hide rows written after cutover", () => {
  const ready = { confirm: true, cutover: "supabase", frozen: true, reverseVerified: true, fieldCompareOk: true };
  assert.equal(decideRollback({ ...ready, confirm: false }).ok, false);
  assert.equal(decideRollback({ ...ready, cutover: "not_supabase" }).ok, false);
  assert.equal(decideRollback({ ...ready, frozen: false }).ok, false);
  assert.equal(decideRollback({ ...ready, reverseVerified: false }).ok, false);
  assert.equal(decideRollback({ ...ready, fieldCompareOk: false }).ok, false);
  assert.equal(decideRollback(ready).ok, true);
  assert.equal(decideUnfreeze({ confirm: false, phase: "frozen" }).ok, false);
  assert.equal(decideUnfreeze({ confirm: true, phase: "frozen" }).ok, true);
  assert.equal(decideUnfreeze({ confirm: true, phase: "cutover" }).ok, false);
  assert.equal(writesPaused("frozen"), true);
  assert.equal(writesPaused("reverse_verified"), true);
  assert.equal(writesPaused("syncing"), true);
  assert.equal(writesPaused("cutover"), false);
  assert.equal(shouldAutoActivate("idle"), true);
  assert.equal(shouldAutoActivate("invalid"), true);
  assert.equal(shouldAutoActivate("cutover"), false);
  assert.equal(shouldAutoActivate("rolled_back"), false);
});

test("record counts must match before a migration is treated as aligned", () => {
  const same = compareCounts({ circles: 2, circle_members: 3, circle_auth: 0, ceremony_invites: 1, couple_access: 0 }, { circles: 2, circle_members: 3, circle_auth: 0, ceremony_invites: 1, couple_access: 0 });
  assert.equal(same.ok, true);
  const different = compareCounts({ circles: 2, circle_members: 0, circle_auth: 0, ceremony_invites: 0, couple_access: 0 }, { circles: 1, circle_members: 0, circle_auth: 0, ceremony_invites: 0, couple_access: 0 });
  assert.equal(different.ok, false);
  assert.equal(different.rows.find((row) => row.table === "circles")?.match, false);
  const unread = compareCounts({ circles: 0, circle_members: 0, circle_auth: 0, ceremony_invites: 0, couple_access: 0 }, { circles: 0, circle_members: 0, circle_auth: 0, ceremony_invites: 0, couple_access: 0 }, false);
  assert.equal(unread.ok, false);
});

test("field compare checks keys, nulls and values, not just counts", () => {
  const source = [{ slug: "a", payload: { chats: [{ id: "1", text: "hello" }] }, edit_key: "k", updated_at: "2026-01-01T00:00:00.000Z" }];
  const same = [{ slug: "a", payload: "{\"chats\":[{\"id\":\"1\",\"text\":\"hello\"}]}", edit_key: "k", updated_at: new Date("2026-01-01T00:00:00.000Z") }];
  assert.equal(compareCoreRows("circles", source, same).ok, true);
  const missing = compareCoreRows("circles", source, []);
  assert.equal(missing.ok, false);
  assert.equal(missing.diffs[0]?.kind, "missing_on_target");
  const extra = compareCoreRows("circles", [], source);
  assert.equal(extra.diffs[0]?.kind, "extra_on_target");
  const changed = compareCoreRows("circles", source, [{ ...source[0], edit_key: null }]);
  assert.equal(changed.diffs.some((diff) => diff.kind === "value" && diff.column === "edit_key"), true);
  const nulls = compareCoreRows("ceremony_invites", [
    { token: "t", slug: "a", code_kind: "guest", code_id: "g", ceremonies: null, created_at: null, expires_at: null, revoked_at: null },
  ], [
    { token: "t", slug: "a", code_kind: "guest", code_id: "g", ceremonies: null, created_at: null, expires_at: null, revoked_at: null },
  ]);
  assert.equal(nulls.ok, true);
  const reordered = compareCoreRows("circles", [
    { slug: "a", payload: { b: 1, a: { z: 1, y: 2 } }, edit_key: "k", updated_at: "2026-01-01T00:00:00.000Z" },
  ], [
    { slug: "a", payload: { a: { y: 2, z: 1 }, b: 1 }, edit_key: "k", updated_at: "2026-01-01T00:00:00+00:00" },
  ]);
  assert.equal(reordered.ok, true);
  const secret = compareCoreRows("circle_auth", [
    { slug: "a", host_code: "SECRET-CODE", cohost_code: "c", family_codes: "f", guest_codes: "g", edit_key: "edit" },
  ], [
    { slug: "a", host_code: "OTHER-CODE", cohost_code: "c", family_codes: "f", guest_codes: "g", edit_key: "edit" },
  ]);
  const described = describeFieldDiffs(secret.diffs);
  assert.equal(described[0]?.column, "credential");
  assert.equal(described[0]?.key, "a");
  assert.doesNotMatch(JSON.stringify(described), /SECRET-CODE|OTHER-CODE/);
  const extraMember = compareCoreRows("circle_members", [], [
    { slug: "nico-lila", member_key: "super-secret-key", email: "", name: "A", role: "guest" },
  ]);
  const shownMember = describeFieldDiffs(extraMember.diffs);
  assert.equal(shownMember[0]?.kind, "extra_on_target");
  assert.match(shownMember[0]?.key || "", /^nico-lila:[0-9a-f]{8}$/);
  assert.doesNotMatch(shownMember[0]?.key || "", /super-secret-key/);
  const fullAccess = CORE_TABLES.map((table) => ({ table, select: true, insert: true, update: true, delete: true }));
  assert.equal(reviewServerAccess({ role: "anon", tables: fullAccess }).ok, false);
  assert.equal(reviewServerAccess({ role: "postgres", tables: fullAccess.map((row) => ({ ...row, delete: row.table !== "circles" })) }).ok, false);
  assert.equal(reviewServerAccess({ role: "postgres", tables: fullAccess }).ok, true);
});

test("reverse sync overwrites the current database and forward copy keeps the newer wedding", () => {
  const columns = ["slug", "payload", "edit_key", "updated_at"];
  assert.match(upsertConflict("circles", columns, "forward"), /updated_at <= excluded.updated_at/);
  assert.doesNotMatch(upsertConflict("circles", columns, "reverse"), /updated_at <=/);
  assert.match(upsertConflict("circle_members", ["slug", "member_key", "role"], "reverse"), /do update set role = excluded.role/);
});

test("paused writes block saves and still allow reads", () => {
  assert.equal(isMutationStatement("insert into circles (slug) values ($1)"), true);
  assert.equal(isMutationStatement("  UPDATE circles set payload = $1"), true);
  assert.equal(isMutationStatement("delete from ceremony_invites where token = $1"), true);
  assert.equal(isMutationStatement("select * from circles"), false);
  assert.equal(isMutationStatement("create table if not exists circles (slug text)"), false);
});

test("public policies are rejected and sign-in stays off the wedding cutover", () => {
  assert.equal(reviewRls({
    tables: CORE_TABLES.map((name) => ({ name, rls: true })),
    policies: [],
  }).ok, true);
  assert.equal(reviewRls({
    tables: CORE_TABLES.map((name) => ({ name, rls: name !== "circles" })),
    policies: [{ table: "circle_auth", roles: "{anon}" }],
  }).ok, false);
  const signIn = FEATURE_PATHS.find((item) => item.feature === "sign-in");
  const chat = FEATURE_PATHS.find((item) => item.feature === "chat");
  const media = FEATURE_PATHS.find((item) => item.feature === "media-bytes");
  assert.equal(signIn?.storage, "supabase");
  assert.equal(chat?.storage, "wedding-data");
  assert.equal(media?.storage, "supabase");
  assert.equal(SCHEMA_INVENTORY.find((item) => item.name === "session")?.intended, "supabase");
  assert.equal(SCHEMA_INVENTORY.find((item) => item.name === "circles")?.intended, "supabase");
  assert.equal(SCHEMA_INVENTORY.find((item) => item.name === "circle_live")?.intended, "supabase");
});

test("persistent routing is Supabase-only and fails closed when unavailable", () => {
  assert.equal(chooseWeddingRoute({ production: true, supabaseConfigured: true, supabaseOpen: true }).use, "supabase");
  assert.equal(chooseWeddingRoute({ production: true, supabaseConfigured: true, supabaseOpen: false }).use, "refuse");
  assert.equal(chooseWeddingRoute({ production: true, supabaseConfigured: false, supabaseOpen: false }).use, "refuse");
  assert.equal(chooseWeddingRoute({ production: false, supabaseConfigured: false, supabaseOpen: false }).use, "preview");
  assert.equal(chooseWeddingRoute({ production: false, supabaseConfigured: true, supabaseOpen: false }).use, "refuse");
  assert.equal(reviewGrants([{ table: "circles", grantee: "anon", privilege: "SELECT" }]).ok, false);
  assert.equal(reviewGrants([]).ok, true);
});

test("reconcile preserves destination-only rows until an explicit archive and copies newer destination writes back", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { archiveDestinationOnly, reconcilePair, restoreOntoSource } = await import("./core-reconcile.ts");
  const { SUPABASE_CORE_SQL: sqlText, SUPABASE_CORE_CONSTRAINTS: constraints } = await import("./core-migration.ts");
  const sourceDb = new PGlite();
  const targetDb = new PGlite();
  const queryOf = (db: InstanceType<typeof PGlite>) => async (text: string, params: unknown[] = []) => (await db.query(text, params)).rows as Record<string, unknown>[];
  const source = queryOf(sourceDb);
  const target = queryOf(targetDb);
  for (const role of ["anon", "authenticated"]) {
    await source(`create role ${role}`).catch(() => undefined);
    await target(`create role ${role}`).catch(() => undefined);
  }
  for (const statement of sqlText.split(";").map((item) => item.trim()).filter(Boolean)) {
    await source(statement);
    await target(statement);
  }
  const payload = { bride: "Lila", groom: "Nico", chats: [{ id: "room", messages: [{ id: "m1", text: "hello" }] }] };
  await source(
    `insert into public.circles (slug, payload, edit_key, updated_at) values ($1, $2::jsonb, $3, $4)`,
    ["nico-lila", JSON.stringify(payload), "edit-key", "2026-10-01T00:00:00.000Z"],
  );
  await source(
    `insert into public.circle_members (slug, member_key, email, name, role) values ($1, $2, $3, $4, $5)`,
    ["nico-lila", "family:ada", "", "Ada", "family"],
  );
  await source(
    `insert into public.circle_auth (slug, host_code, cohost_code, family_codes, guest_codes, edit_key) values ($1, $2, $3, $4, $5, $6)`,
    ["nico-lila", "host", "cohost", "fam", "guest", "edit-key"],
  );
  await target(
    `insert into public.circles (slug, payload, edit_key, updated_at) values ($1, $2::jsonb, $3, $4)`,
    ["nico-lila", JSON.stringify({ bride: "Lila", groom: "Nico", chats: [] }), "edit-key", "2026-09-01T00:00:00.000Z"],
  );
  await target(
    `insert into public.circle_members (slug, member_key, email, name, role) values ($1, $2, $3, $4, $5)`,
    ["nico-lila", "gone", "", "Gone", "guest"],
  );
  const copied = await reconcilePair(source, target);
  assert.equal(copied.ok, false);
  const members = await target(`select member_key from public.circle_members order by member_key`);
  assert.deepEqual(members.map((row) => row.member_key), ["family:ada", "gone"]);
  const recovery = await target(`select count(*)::int as n from public.wedding_core_recovery`);
  assert.ok(Number(recovery[0]?.n) >= 1);
  const saved = await target(`select payload from public.circles where slug = $1`, ["nico-lila"]);
  const body = typeof saved[0]?.payload === "string" ? JSON.parse(saved[0].payload) : saved[0]?.payload;
  assert.equal(body.chats[0].messages[0].text, "hello");
  const archived = await archiveDestinationOnly(source, target);
  assert.equal(archived.ok, true);
  assert.equal(archived.removed, 1);
  const afterArchive = await target(`select member_key from public.circle_members order by member_key`);
  assert.deepEqual(afterArchive.map((row) => row.member_key), ["family:ada"]);
  const again = await reconcilePair(source, target);
  assert.equal(again.ok, true, again.ok ? "" : again.error);
  await target(`update public.circles set edit_key = $1, updated_at = $2 where slug = $3`, ["newer-key", "2026-12-01T00:00:00.000Z", "nico-lila"]);
  const blocked = await reconcilePair(source, target);
  assert.equal(blocked.ok, false);
  const kept = await target(`select edit_key from public.circles where slug = $1`, ["nico-lila"]);
  assert.equal(kept[0]?.edit_key, "newer-key");
  const later = { bride: "Lila", groom: "Nico", chats: [{ id: "room", messages: [{ id: "m1", text: "after cutover" }] }] };
  await target(`update public.circles set payload = $1::jsonb, updated_at = $2 where slug = $3`, [JSON.stringify(later), "2026-12-02T00:00:00.000Z", "nico-lila"]);
  const restored = await restoreOntoSource(target, source);
  assert.equal(restored.ok, true);
  const sourceSaved = await source(`select payload, edit_key from public.circles where slug = $1`, ["nico-lila"]);
  const sourceBody = typeof sourceSaved[0]?.payload === "string" ? JSON.parse(String(sourceSaved[0]?.payload)) : sourceSaved[0]?.payload as { chats: { messages: { text: string }[] }[] };
  assert.equal(sourceBody.chats[0].messages[0].text, "after cutover");
  assert.equal(sourceSaved[0]?.edit_key, "newer-key");
  for (const statement of constraints) assert.match(statement, /foreign key/i);
});

test("browser code does not contain database credentials", () => {
  const roots = [join(process.cwd(), "src", "components"), join(process.cwd(), "src", "routes")];
  const banned = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL", "postgres://", "postgresql://"];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx|ts|jsx|js)$/.test(entry)) files.push(path);
    }
  };
  for (const root of roots) walk(root);
  const hits = files.filter((file) => {
    const text = readFileSync(file, "utf8");
    return banned.some((word) => text.includes(word));
  });
  assert.deepEqual(hits, []);
});
