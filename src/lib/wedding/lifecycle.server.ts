import { getSql } from "@/lib/db";
import {
  RETENTION_FEE_LABEL,
  RETENTION_FEE_PAISE,
  applyPaidExtension,
  currentReminderSlot,
  freshLifecycle,
  readyToDelete,
  reminderCopy,
  remindersOpen,
  type Lifecycle,
} from "@/lib/wedding/lifecycle";

type Sql = Awaited<ReturnType<typeof getSql>>;

const globalRef = globalThis as typeof globalThis & { __wcLifecycleAt?: number; __wcLifecycleReady?: boolean };

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return "";
}

async function coreSql() {
  const { weddingDataSql } = await import("@/lib/developer/core-route.server");
  return weddingDataSql();
}

export async function ensureLifecycle(sql: Sql) {
  if (globalRef.__wcLifecycleReady) return;
  await sql`alter table circles add column if not exists created_at timestamptz`;
  await sql`alter table circles add column if not exists expires_at timestamptz`;
  await sql`alter table circles add column if not exists media_retention_until timestamptz`;
  await sql`create table if not exists circle_expiry_reminders (
    slug text not null,
    slot timestamptz not null,
    title text not null,
    body text not null,
    created_at timestamptz not null default now(),
    primary key (slug, slot)
  )`;
  await sql`create table if not exists circle_retention_payments (
    id text primary key,
    slug text not null,
    amount_paise integer not null,
    status text not null,
    reference text not null unique,
    created_at timestamptz not null default now(),
    paid_at timestamptz
  )`;
  await sql`create table if not exists circle_lifecycle_audit (
    id text primary key,
    slug text not null,
    action text not null,
    detail text not null default '',
    created_at timestamptz not null default now()
  )`;
  globalRef.__wcLifecycleReady = true;
}

function lifeFromRow(row: { created_at?: unknown; expires_at?: unknown; media_retention_until?: unknown } | undefined): Lifecycle | null {
  const createdAt = iso(row?.created_at);
  const expiresAt = iso(row?.expires_at);
  const mediaRetentionUntil = iso(row?.media_retention_until);
  if (!createdAt || !expiresAt || !mediaRetentionUntil) return null;
  return { createdAt, expiresAt, mediaRetentionUntil };
}

/** Keep the server dates. A client payload cannot move them. Legacy rows with no server date are left unset. */
export async function lockLifecycle(sql: Sql, slug: string, payload: Record<string, unknown>, isNew: boolean) {
  await ensureLifecycle(sql);
  if (isNew) {
    const clock = (await sql<{ created: Date | string; expires: Date | string }>`select now() as created, now() + interval '30 days' as expires`)[0];
    const life = freshLifecycle(Date.parse(iso(clock?.created)));
    return {
      payload: { ...payload, ...life },
      stamp: life,
    };
  }
  const row = (await sql<{ created_at: unknown; expires_at: unknown; media_retention_until: unknown }>`
    select created_at, expires_at, media_retention_until from circles where slug = ${slug} limit 1
  `)[0];
  const life = lifeFromRow(row);
  if (!life) {
    const next = { ...payload };
    delete next.createdAt;
    delete next.expiresAt;
    delete next.mediaRetentionUntil;
    return { payload: next, stamp: null as Lifecycle | null };
  }
  return { payload: { ...payload, ...life }, stamp: null as Lifecycle | null };
}

async function audit(sql: Sql, slug: string, action: string, detail = "") {
  const id = `${action}:${slug}:${Date.now()}`;
  await sql`insert into circle_lifecycle_audit (id, slug, action, detail) values (${id}, ${slug}, ${action}, ${detail.slice(0, 120)})`;
}

async function purgeStorage(slug: string) {
  const media = await getSql();
  let files: { id: string; provider: string; chunks: number }[] = [];
  try {
    files = await media`select id, provider, chunks from circle_media where slug = ${slug}`;
  } catch (error) {
    const message = String((error as { message?: string })?.message || error);
    if (!/does not exist|column/i.test(message)) throw error;
    try {
      const plain = await media<{ id: string }>`select id from circle_media where slug = ${slug}`;
      files = plain.map((row) => ({ id: row.id, provider: "library", chunks: 1 }));
    } catch (again) {
      const text = String((again as { message?: string })?.message || again);
      if (!/does not exist/i.test(text)) throw again;
    }
  }
  const remote = files.filter((file) => file.provider === "firebase");
  if (remote.length) {
    const { deleteFirebaseChunks } = await import("@/lib/developer/firebase-storage.server");
    for (const file of remote) {
      const removed = await deleteFirebaseChunks(slug, file.id, Number(file.chunks) || 1);
      if (!removed) throw new Error("Cloud media could not be deleted.");
    }
  }
  const steps = [
    () => media`delete from circle_media_part where id in (select id from circle_media where slug = ${slug})`,
    () => media`delete from circle_media_remote where id in (select id from circle_media where slug = ${slug})`,
    () => media`delete from circle_media where slug = ${slug}`,
    () => media`delete from circle_live where slug = ${slug}`,
    () => media`delete from circle_live_signal where slug = ${slug}`,
    () => media`delete from google_media where slug = ${slug}`,
    () => media`delete from google_uploads where slug = ${slug}`,
  ];
  for (const run of steps) {
    try {
      await run();
    } catch (error) {
      const message = String((error as { message?: string })?.message || error);
      if (!/does not exist/i.test(message)) throw error;
    }
  }
}

export async function runLifecycle(now = new Date()) {
  const sql = await coreSql();
  await ensureLifecycle(sql);
  const nowIso = now.toISOString();
  let reminded = 0;
  let deleted = 0;
  const due = await sql<{ slug: string; payload: unknown; expires_at: unknown; media_retention_until: unknown }>`
    select slug, payload, expires_at, media_retention_until
    from circles
    where expires_at is not null
      and media_retention_until is not null
      and expires_at <= ${nowIso}::timestamptz
      and media_retention_until <= ${nowIso}::timestamptz
      and coalesce(payload->>'deleted', 'false') <> 'true'
      and slug <> 'lila-nico'
    limit 5
  `;
  for (const row of due) {
    const again = (await sql<{ expires_at: unknown; media_retention_until: unknown; payload: unknown }>`
      select expires_at, media_retention_until, payload from circles where slug = ${row.slug} limit 1
    `)[0];
    const check = lifeFromRow({
      created_at: again?.expires_at,
      expires_at: again?.expires_at,
      media_retention_until: again?.media_retention_until,
    });
    if (!check || !readyToDelete(check, now.getTime())) continue;
    const payload = typeof again?.payload === "string" ? JSON.parse(again.payload) : again?.payload;
    if (payload?.deleted === true || payload?.illustrated === true) continue;
    try {
      await purgeStorage(row.slug);
    } catch {
      await audit(sql, row.slug, "retry-media", "storage delete will be tried again");
      continue;
    }
    const tomb = JSON.stringify({ slug: row.slug, deleted: true, deletedAt: nowIso, rev: Date.now() });
    await sql`update circles set payload = ${tomb}::jsonb, updated_at = now() where slug = ${row.slug}`;
    try {
      await sql`delete from circle_members where slug = ${row.slug}`;
      await sql`delete from circle_auth where slug = ${row.slug}`;
      await sql`delete from ceremony_invites where slug = ${row.slug}`;
      await sql`delete from couple_access where slug = ${row.slug}`;
    } catch (error) {
      const message = String((error as { message?: string })?.message || error);
      if (!/does not exist/i.test(message)) await audit(sql, row.slug, "retry-links", "related rows will be tried again");
    }
    await audit(sql, row.slug, "expired", "wedding closed after the retention deadline");
    deleted += 1;
  }
  const window = await sql<{ slug: string; payload: unknown; expires_at: unknown; media_retention_until: unknown }>`
    select slug, payload, expires_at, media_retention_until
    from circles
    where expires_at is not null
      and expires_at > ${nowIso}::timestamptz
      and expires_at <= ${nowIso}::timestamptz + interval '7 days'
      and media_retention_until <= expires_at
      and coalesce(payload->>'deleted', 'false') <> 'true'
      and slug <> 'lila-nico'
    limit 20
  `;
  for (const row of window) {
    const life = lifeFromRow({ created_at: row.expires_at, expires_at: row.expires_at, media_retention_until: row.media_retention_until });
    if (!life || !remindersOpen(life, now.getTime())) continue;
    const slot = currentReminderSlot(life.expiresAt, now.getTime());
    if (!slot) continue;
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    const name = payload?.bride && payload?.groom ? `${payload.bride} & ${payload.groom}` : "Your wedding";
    const copy = reminderCopy(name, life.expiresAt);
    const inserted = (await sql`
      insert into circle_expiry_reminders (slug, slot, title, body)
      values (${row.slug}, ${slot}::timestamptz, ${copy.title}, ${copy.body})
      on conflict (slug, slot) do nothing
      returning slot
    `)[0];
    if (inserted) reminded += 1;
  }
  globalRef.__wcLifecycleAt = Date.now();
  return { reminded, deleted };
}

export async function remindersForHost(sql: Sql, slug: string, memberKey: string) {
  if (!memberKey || slug === "lila-nico") return [];
  try {
    await ensureLifecycle(sql);
    const member = (await sql<{ role: string }>`select role from circle_members where slug = ${slug} and member_key = ${memberKey} limit 1`)[0];
    if (!member || (member.role !== "host" && member.role !== "cohost")) return [];
    if (!globalRef.__wcLifecycleAt || Date.now() - globalRef.__wcLifecycleAt > 10 * 60 * 1000) {
      await runLifecycle();
    }
    return await sql<{ slot: string | Date; title: string; body: string }>`
      select slot, title, body from circle_expiry_reminders
      where slug = ${slug} and created_at > now() - interval '8 days'
      order by slot desc
      limit 2
    `;
  } catch {
    return [];
  }
}

/** Records a pending ₹150 retention payment. Nothing is charged and the deadline does not move. */
export async function openRetentionExtension(input: { slug: string; editKey: string }) {
  const sql = await coreSql();
  await ensureLifecycle(sql);
  const row = (await sql<{ edit_key: string; created_at: unknown; expires_at: unknown; media_retention_until: unknown }>`
    select edit_key, created_at, expires_at, media_retention_until from circles where slug = ${input.slug} limit 1
  `)[0];
  if (!row || row.edit_key !== input.editKey) return { ok: false as const, error: "Only the host phone can extend this wedding's media." };
  const life = lifeFromRow(row);
  if (!life) return { ok: false as const, error: "This wedding has no server expiry date yet, so retention was not changed." };
  const reference = `RET-${input.slug}-${Date.now().toString(36)}`.slice(0, 80);
  await sql`
    insert into circle_retention_payments (id, slug, amount_paise, status, reference)
    values (${reference}, ${input.slug}, ${RETENTION_FEE_PAISE}, 'pending', ${reference})
  `;
  return {
    ok: true as const,
    status: "pending" as const,
    reference,
    amount: RETENTION_FEE_LABEL,
    period: "30 days of cloud media retention",
    expiresAt: life.expiresAt,
    mediaRetentionUntil: life.mediaRetentionUntil,
    message: "A payment provider is not connected. No charge was made, and cloud media retention was not extended. Retention moves only after the provider confirms ₹150 on the server.",
  };
}

/** Used by a future payment webhook. A pending or failed row does not move the deadline. */
export async function settleRetentionPayment(reference: string, status: "paid" | "failed") {
  const sql = await coreSql();
  await ensureLifecycle(sql);
  const payment = (await sql<{ slug: string; status: string; reference: string }>`
    select slug, status, reference from circle_retention_payments where reference = ${reference} limit 1
  `)[0];
  if (!payment) return { ok: false as const, error: "That payment was not found." };
  if (payment.status === "paid") return { ok: true as const, applied: false, reason: "already-applied" };
  if (status !== "paid") {
    await sql`update circle_retention_payments set status = 'failed' where reference = ${reference} and status = 'pending'`;
    return { ok: true as const, applied: false, reason: "not-paid" };
  }
  const won = (await sql<{ slug: string }>`
    update circle_retention_payments
    set status = 'paid', paid_at = now()
    where reference = ${reference} and status = 'pending'
    returning slug
  `)[0];
  if (!won) return { ok: true as const, applied: false, reason: "already-applied" };
  const row = (await sql<{ created_at: unknown; expires_at: unknown; media_retention_until: unknown; payload: unknown }>`
    select created_at, expires_at, media_retention_until, payload from circles where slug = ${won.slug} limit 1
  `)[0];
  const life = lifeFromRow(row);
  if (!life) {
    await sql`update circle_retention_payments set status = 'pending', paid_at = null where reference = ${reference}`;
    return { ok: false as const, error: "Retention was not extended because the wedding deadline is missing." };
  }
  const applied = applyPaidExtension(life, { status: "paid", reference }, []);
  try {
    const payload = typeof row?.payload === "string" ? JSON.parse(row.payload) : { ...(row?.payload as object) };
    payload.createdAt = applied.life.createdAt;
    payload.expiresAt = applied.life.expiresAt;
    payload.mediaRetentionUntil = applied.life.mediaRetentionUntil;
    await sql`
      update circles
      set media_retention_until = ${applied.life.mediaRetentionUntil}::timestamptz,
          payload = ${JSON.stringify(payload)}::jsonb,
          updated_at = now()
      where slug = ${won.slug}
    `;
  } catch (error) {
    await sql`update circle_retention_payments set status = 'pending', paid_at = null where reference = ${reference}`;
    throw error;
  }
  await audit(sql, won.slug, "retention-extended", reference);
  return { ok: true as const, applied: true, mediaRetentionUntil: applied.life.mediaRetentionUntil, expiresAt: applied.life.expiresAt };
}
