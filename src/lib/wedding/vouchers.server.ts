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

function payloadObject(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? value as Record<string, unknown> : null;
}

export async function generateVouchers(token: string, count: number, expiresAt: string | null) {
  const session = await requireDeveloper(token);
  if (!session.ok) return { ok: false as const, error: session.error };
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
  const created: { code: string; hint: string }[] = [];
  for (let n = 0; n < total; n += 1) {
    let stored = false;
    for (let attempt = 0; attempt < 6 && !stored; attempt += 1) {
      const code = newCode();
      const hash = sha256(code);
      try {
        await sql`
          insert into wedding_vouchers (id, code_hash, code_hint, status, expires_at, created_by)
          values (${newId()}, ${hash}, ${voucherHint(code)}, ${"unused"}, ${expiry}, ${session.email})
        `;
        created.push({ code, hint: voucherHint(code) });
        stored = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!/duplicate|unique/i.test(message)) throw error;
      }
    }
    if (!stored) return { ok: false as const, error: "A voucher could not be generated. Try again." };
  }
  await audit(session.email, "Generate wedding vouchers", `${created.length} code${created.length === 1 ? "" : "s"} issued.`, "ok");
  return { ok: true as const, vouchers: created };
}

export async function listVouchers(token: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return { ok: false as const, error: session.error };
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
      status: row.status,
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
  const circle = (await sql<{ edit_key: string; payload: unknown }>`
    select edit_key, payload from circles where slug = ${slug} limit 1
  `)[0];
  if (!circle || circle.edit_key !== editKey) {
    return { ok: false as const, error: "This wedding could not be updated with that voucher." };
  }
  const payload = payloadObject(circle.payload);
  if (!payload) return { ok: false as const, error: "This wedding could not be updated with that voucher." };
  const hash = sha256(clean);
  const claimed = await sql<{ id: string; code_hint: string }>`
    update wedding_vouchers
    set status = 'redeemed', redeemed_at = now(), wedding_slug = ${slug}, wedding_id = ${typeof payload.id === "string" ? payload.id : slug}
    where code_hash = ${hash} and status = 'unused' and (expires_at is null or expires_at > now())
    returning id, code_hint
  `;
  if (!claimed[0]) {
    const existing = (await sql<{ status: string; expires_at: string | null }>`
      select status, expires_at from wedding_vouchers where code_hash = ${hash} limit 1
    `)[0];
    const decision = redeemDecision(existing ?? null);
    if (!decision.ok) return decision;
    return { ok: false as const, error: "That voucher could not be used." };
  }
  const hint = claimed[0].code_hint;
  const reference = `VOUCHER-${hint}`;
  const payment = {
    ...(payload.payment && typeof payload.payment === "object" ? payload.payment as Record<string, unknown> : {}),
    status: "paid",
    verified: true,
    reference,
    provider: "preview",
  };
  const next = { ...payload, payment };
  try {
    const saved = await sql<{ slug: string }>`
      update circles
      set payload = ${JSON.stringify(next)}::jsonb, updated_at = now()
      where slug = ${slug} and edit_key = ${editKey}
      returning slug
    `;
    if (!saved[0]) throw new Error("missing");
  } catch {
    await sql`
      update wedding_vouchers
      set status = 'unused', redeemed_at = null, wedding_id = null, wedding_slug = null
      where id = ${claimed[0].id} and wedding_slug = ${slug} and status = 'redeemed'
    `;
    return { ok: false as const, error: "The voucher was not used because the wedding could not be updated." };
  }
  await audit("voucher", "Redeem wedding voucher", `Hint ${hint} on ${slug}.`, "ok").catch(() => undefined);
  return { ok: true as const, hint, reference, weddingId: typeof payload.id === "string" ? payload.id : slug };
}
