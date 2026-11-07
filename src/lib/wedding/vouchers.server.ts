import { createHash, randomBytes, randomInt } from "node:crypto";
import { getSql } from "@/lib/db";
import { requireDeveloper } from "@/lib/developer/gate.server";
import { VOUCHER_ALPHABET, codeFromBytes, normalizeVoucherCode, redeemDecision, voucherHint, voucherLooksValid } from "./vouchers.ts";

type VoucherRow = {
  id: string;
  code_hint: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  wedding_id: string | null;
  wedding_slug: string | null;
  revoked_at: string | null;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function newId() {
  return randomBytes(16).toString("hex");
}

function newCode() {
  const bytes = new Uint8Array(12);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = randomInt(VOUCHER_ALPHABET.length);
  return codeFromBytes(bytes);
}

async function audit(email: string, command: string, interpretation: string, result: string) {
  const sql = await getSql();
  await sql`
    insert into developer_audit (id, email, command, interpretation, level, action, result)
    values (${newId()}, ${email}, ${command}, ${interpretation}, ${"green"}, ${"voucher"}, ${result})
  `;
}

export async function generateVouchers(email: string, count: number, expiresAt: string | null) {
  const total = Number.isInteger(count) ? Math.min(20, Math.max(1, count)) : 1;
  let expiry: string | null = null;
  if (expiresAt) {
    const when = new Date(expiresAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      return { ok: false as const, error: "That expiry date is not in the future." };
    }
    expiry = when.toISOString();
  }
  const sql = await getSql();
  const issued = Array.from({ length: total }, () => {
    const code = newCode();
    return { id: newId(), code, hint: voucherHint(code) };
  });
  const rows = issued.map(({ id, code, hint }) => ({ id, hash: sha256(code), hint }));
  await sql`
    insert into wedding_vouchers (id, code_hash, code_hint, status, expires_at, created_by)
    select id, hash, hint, 'unused', ${expiry}::timestamptz, ${email}
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as batch(id text, hash text, hint text)
  `;
  await audit(email, "Generate wedding vouchers", `${issued.length} code${issued.length === 1 ? "" : "s"} issued.`, "ok").catch(() => undefined);
  return { ok: true as const, vouchers: issued.map(({ code, hint }) => ({ code, hint })) };
}

export async function listVouchers() {
  const sql = await getSql();
  const rows = await sql<VoucherRow>`
    select id, code_hint, status, created_at, expires_at, redeemed_at, wedding_id, wedding_slug, revoked_at
    from wedding_vouchers
    order by created_at desc
    limit 100
  `;
  return {
    ok: true as const,
    vouchers: rows.map((row) => ({
      id: row.id,
      hint: row.code_hint,
      status: row.status === "unused" && row.expires_at && new Date(row.expires_at).getTime() <= Date.now() ? "expired" : row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      redeemedAt: row.redeemed_at,
      weddingId: row.wedding_id,
      weddingSlug: row.wedding_slug,
      revokedAt: row.revoked_at,
    })),
  };
}

export async function revokeVoucher(token: string, id: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return { ok: false as const, error: session.error };
  const clean = id.trim();
  if (!clean) return { ok: false as const, error: "That voucher could not be revoked." };
  const sql = await getSql();
  const rows = await sql<{ id: string; code_hint: string }>`
    update wedding_vouchers
    set status = 'revoked', revoked_at = now()
    where id = ${clean} and status = 'unused'
    returning id, code_hint
  `;
  if (!rows[0]) return { ok: false as const, error: "Only an unused voucher can be revoked." };
  await audit(session.email, "Revoke wedding voucher", `Hint ${rows[0].code_hint}.`, "ok");
  return { ok: true as const };
}

export async function validateVoucher(code: string) {
  const clean = normalizeVoucherCode(code);
  if (!voucherLooksValid(clean)) return { ok: false as const, error: "That voucher code was not recognised." };
  const sql = await getSql();
  const rows = await sql<{ status: string; expires_at: string | null; code_hint: string }>`
    select status, expires_at, code_hint from wedding_vouchers where code_hash = ${sha256(clean)} limit 1
  `;
  const decision = redeemDecision(rows[0] ?? null);
  if (!decision.ok) return decision;
  return { ok: true as const, hint: rows[0].code_hint, amountDue: 0, label: "This voucher covers one premium wedding. Amount due ₹0." };
}

export async function redeemVoucher(input: { code: string; slug: string; editKey: string }) {
  const clean = normalizeVoucherCode(input.code);
  const slug = input.slug.trim();
  const editKey = input.editKey.trim();
  if (!voucherLooksValid(clean) || !slug || editKey.length < 16) {
    return { ok: false as const, error: "That voucher code was not recognised." };
  }
  const sql = await getSql();
  const hash = sha256(clean);
  const claimed = await sql<{ code_hint: string; wedding_id: string }>`
    with target as (
      select slug, coalesce(payload->>'id', slug) as wedding_id
      from circles
      where slug = ${slug} and edit_key = ${editKey}
        and jsonb_typeof(payload) = 'object'
        and (
          (payload #> '{payment,verified}') is distinct from 'true'::jsonb
          or payload #>> '{payment,status}' = 'failed'
        )
      for update
    ), claimed as (
      update wedding_vouchers v
      set status = 'redeemed', redeemed_at = now(), wedding_slug = target.slug, wedding_id = target.wedding_id
      from target
      where v.code_hash = ${hash} and v.status = 'unused' and (v.expires_at is null or v.expires_at > now())
      returning v.code_hint, v.wedding_id, v.wedding_slug
    )
    update circles c
    set payload = jsonb_set(
      c.payload, '{payment}',
      (case when jsonb_typeof(c.payload->'payment') = 'object' then c.payload->'payment' else '{}'::jsonb end)
      || jsonb_build_object('status', 'paid', 'verified', true, 'reference', 'VOUCHER-' || claimed.code_hint, 'provider', 'preview')
    ) || jsonb_build_object('rev', coalesce((c.payload->>'rev')::int, 0) + 1),
      updated_at = now()
    from claimed
    where c.slug = claimed.wedding_slug
    returning claimed.code_hint, claimed.wedding_id
  `;
  let applied = claimed[0];
  if (!applied) {
    const previous = await sql<{ code_hint: string; wedding_id: string }>`
      select v.code_hint, v.wedding_id
      from wedding_vouchers v join circles c on c.slug = v.wedding_slug
      where v.code_hash = ${hash} and v.status = 'redeemed'
        and c.slug = ${slug} and c.edit_key = ${editKey}
        and c.payload #> '{payment,verified}' = 'true'::jsonb
        and c.payload #>> '{payment,reference}' = 'VOUCHER-' || v.code_hint
      limit 1
    `;
    applied = previous[0];
    if (!applied) {
      const [existing] = await sql<{ status: string; expires_at: string | null }>`
        select status, expires_at from wedding_vouchers where code_hash = ${hash} limit 1
      `;
      const decision = redeemDecision(existing ?? null);
      if (!decision.ok) return decision;
      return { ok: false as const, error: "This wedding could not be upgraded with that voucher." };
    }
  } else {
    await audit("voucher", "Redeem wedding voucher", `Hint ${applied.code_hint} on ${slug}.`, "ok").catch(() => undefined);
  }
  const hint = applied.code_hint;
  return { ok: true as const, hint, reference: `VOUCHER-${hint}`, weddingId: applied.wedding_id };
}
