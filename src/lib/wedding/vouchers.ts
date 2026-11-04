export const VOUCHER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type VoucherStatus = "unused" | "redeemed" | "expired" | "revoked";

export type VoucherDecisionRow = {
  status: string;
  expires_at?: string | null;
};

export function normalizeVoucherCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function voucherLooksValid(code: string) {
  return new RegExp(`^[${VOUCHER_ALPHABET}]{12}$`).test(normalizeVoucherCode(code));
}

export function codeFromBytes(bytes: Uint8Array) {
  let code = "";
  for (let i = 0; i < 12; i += 1) code += VOUCHER_ALPHABET[(bytes[i] ?? 0) % VOUCHER_ALPHABET.length];
  return code;
}

export function voucherHint(code: string) {
  const clean = normalizeVoucherCode(code);
  return clean.slice(-4);
}

export function redeemDecision(row: VoucherDecisionRow | null, now = Date.now()) {
  if (!row) return { ok: false as const, error: "That voucher code was not recognised." };
  if (row.status === "redeemed") return { ok: false as const, error: "That voucher has already been used." };
  if (row.status === "revoked") return { ok: false as const, error: "That voucher has been revoked." };
  if (row.status === "expired") return { ok: false as const, error: "That voucher has expired." };
  if (row.expires_at) {
    const expires = new Date(row.expires_at).getTime();
    if (Number.isFinite(expires) && expires <= now) return { ok: false as const, error: "That voucher has expired." };
  }
  if (row.status !== "unused") return { ok: false as const, error: "That voucher cannot be used." };
  return { ok: true as const };
}

/** Mirrors the one-row claim the database update performs. A second call cannot redeem the same row. */
export function claimVoucher(row: VoucherDecisionRow | null, now = Date.now()) {
  const decision = redeemDecision(row, now);
  if (!decision.ok || !row) return decision;
  row.status = "redeemed";
  return { ok: true as const };
}
