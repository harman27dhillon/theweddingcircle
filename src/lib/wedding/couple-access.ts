import { isSenderId } from "./identity.ts";
import type { CoupleAccess, CoupleCodeRecord, CoupleRoleName, CoupleSeat } from "./types.ts";
import type { CoupleCodeStatus } from "./types.ts";

export type { CoupleAccess, CoupleCodeRecord, CoupleCodeStatus, CoupleRoleName, CoupleSeat };

export function compactCoupleCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function coupleAccessForPublish(access: CoupleAccess | undefined): CoupleAccess | undefined {
  if (!access) return undefined;
  const next: CoupleAccess = {};
  if (access.bride?.accountId) next.bride = { accountId: access.bride.accountId, name: access.bride.name };
  if (access.groom?.accountId) next.groom = { accountId: access.groom.accountId, name: access.groom.name };
  if (access.brideCode) next.brideCode = { code: "", status: access.brideCode.status, claimedBy: access.brideCode.claimedBy };
  if (access.groomCode) next.groomCode = { code: "", status: access.groomCode.status, claimedBy: access.groomCode.claimedBy };
  if (!next.bride && !next.groom && !next.brideCode && !next.groomCode) return undefined;
  return next;
}

export function mergeCoupleAccess(local: CoupleAccess | undefined, remote: CoupleAccess | undefined, keepSecrets: boolean): CoupleAccess | undefined {
  const bride = remote?.bride?.accountId ? remote.bride : local?.bride;
  const groom = remote?.groom?.accountId ? remote.groom : local?.groom;
  const brideCode = keepSecrets ? local?.brideCode : remote?.brideCode ? { ...remote.brideCode, code: "" } : undefined;
  const groomCode = keepSecrets ? local?.groomCode : remote?.groomCode ? { ...remote.groomCode, code: "" } : undefined;
  if (!bride && !groom && !brideCode && !groomCode) return undefined;
  return { bride, groom, brideCode, groomCode };
}

export function selfCoupleRole(access: CoupleAccess | undefined, accountId: string): CoupleRoleName | "neither" {
  if (accountId && access?.bride?.accountId === accountId) return "bride";
  if (accountId && access?.groom?.accountId === accountId) return "groom";
  return "neither";
}

export function assignCoupleSeat(
  access: CoupleAccess | undefined,
  role: CoupleRoleName,
  seat: CoupleSeat | null,
): { ok: true; access: CoupleAccess } | { ok: false; error: "missing-id" | "both" } {
  if (seat && !isSenderId(seat.accountId)) return { ok: false, error: "missing-id" };
  const other = role === "bride" ? access?.groom : access?.bride;
  if (seat && other?.accountId === seat.accountId) return { ok: false, error: "both" };
  const next: CoupleAccess = { ...(access ?? {}) };
  if (role === "bride") {
    if (seat) next.bride = seat;
    else delete next.bride;
  } else if (seat) next.groom = seat;
  else delete next.groom;
  return { ok: true, access: next };
}

export function issueCoupleCode(access: CoupleAccess | undefined, role: CoupleRoleName, code: string): CoupleAccess | null {
  const compact = compactCoupleCode(code);
  if (compact.length < 12 || compact.length > 40) return null;
  const next: CoupleAccess = { ...(access ?? {}) };
  const record: CoupleCodeRecord = { code: code.trim().toUpperCase(), status: "active" };
  if (role === "bride") next.brideCode = record;
  else next.groomCode = record;
  return next;
}

export function revokeCoupleCode(access: CoupleAccess | undefined, role: CoupleRoleName): CoupleAccess {
  const next: CoupleAccess = { ...(access ?? {}) };
  const current = role === "bride" ? next.brideCode : next.groomCode;
  if (!current) return next;
  const record: CoupleCodeRecord = { ...current, status: "revoked" };
  if (role === "bride") next.brideCode = record;
  else next.groomCode = record;
  return next;
}

export type CoupleClaimError = "invalid" | "revoked" | "claimed" | "both" | "unsigned";

export function claimCoupleCode(
  access: CoupleAccess | undefined,
  code: string,
  accountId: string,
  name: string,
): { ok: true; role: CoupleRoleName; access: CoupleAccess } | { ok: false; error: CoupleClaimError } {
  if (!isSenderId(accountId)) return { ok: false, error: "unsigned" };
  const compact = compactCoupleCode(code);
  if (compact.length < 12) return { ok: false, error: "invalid" };
  const brideHit = Boolean(access?.brideCode?.code) && compactCoupleCode(access?.brideCode?.code ?? "") === compact;
  const groomHit = Boolean(access?.groomCode?.code) && compactCoupleCode(access?.groomCode?.code ?? "") === compact;
  if (!brideHit && !groomHit) return { ok: false, error: "invalid" };
  if (brideHit && groomHit) return { ok: false, error: "invalid" };
  const role: CoupleRoleName = brideHit ? "bride" : "groom";
  const record = role === "bride" ? access?.brideCode : access?.groomCode;
  if (!record || record.status === "revoked") return { ok: false, error: "revoked" };
  if (record.status === "claimed" && record.claimedBy && record.claimedBy !== accountId) return { ok: false, error: "claimed" };
  const current = role === "bride" ? access?.bride : access?.groom;
  if (current?.accountId && current.accountId !== accountId) return { ok: false, error: "claimed" };
  const other = role === "bride" ? access?.groom : access?.bride;
  if (other?.accountId === accountId) return { ok: false, error: "both" };
  const seat: CoupleSeat = { accountId, name: name.trim().slice(0, 80) || (role === "bride" ? "Bride" : "Groom") };
  const next: CoupleAccess = {
    ...(access ?? {}),
    [role]: seat,
    [`${role}Code`]: { ...record, status: "claimed", claimedBy: accountId },
  };
  return { ok: true, role, access: next };
}

export function claimAcrossWeddings<T extends { id: string; slug: string; coupleAccess?: CoupleAccess }>(
  weddings: T[],
  code: string,
  accountId: string,
  name: string,
) {
  let invalid = true;
  for (const wedding of weddings) {
    const result = claimCoupleCode(wedding.coupleAccess, code, accountId, name);
    if (result.ok) return { ok: true as const, weddingId: wedding.id, slug: wedding.slug, role: result.role, access: result.access };
    if (result.error !== "invalid") return { ok: false as const, error: result.error, slug: wedding.slug };
    if (result.error === "invalid" && codeTouches(wedding.coupleAccess, code)) invalid = false;
  }
  return { ok: false as const, error: invalid ? ("invalid" as const) : ("revoked" as const) };
}

function codeTouches(access: CoupleAccess | undefined, code: string) {
  const compact = compactCoupleCode(code);
  return compactCoupleCode(access?.brideCode?.code ?? "") === compact || compactCoupleCode(access?.groomCode?.code ?? "") === compact;
}

export function codeStatusLabel(record: CoupleCodeRecord | undefined) {
  if (!record) return "No code";
  if (record.status === "active" && record.code) return "Active";
  if (record.status === "claimed") return "Claimed";
  if (record.status === "revoked") return "Revoked";
  return "No code";
}
