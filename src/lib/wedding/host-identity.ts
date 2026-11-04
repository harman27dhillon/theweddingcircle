/** Stable account ids and host membership. Display names are never part of this decision. */

export type MemberClaim = {
  member_key: string;
  role: string;
  email: string;
  account_id?: string;
};

const RANK: Record<string, number> = { guest: 1, family: 2, cohost: 3, host: 4 };

export function pickMembership(
  rows: MemberClaim[],
  input: { accountId?: string; memberKey?: string; email?: string },
): { row?: MemberClaim; review: boolean } {
  const accountId = (input.accountId || "").trim();
  const memberKey = (input.memberKey || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  if (accountId) {
    const hits = rows.filter((row) => (row.account_id || "") === accountId);
    if (hits.length === 1) return { row: hits[0], review: false };
    if (hits.length > 1) {
      const roles = new Set(hits.map((row) => row.role));
      if (roles.size === 1) return { row: hits[0], review: false };
      return { review: true };
    }
  }
  if (memberKey) {
    const hit = rows.find((row) => row.member_key === memberKey);
    if (hit) return { row: hit, review: false };
  }
  if (email) {
    const hits = rows.filter((row) => row.email.trim().toLowerCase() === email);
    if (hits.length === 1) return { row: hits[0], review: false };
    if (hits.length > 1) {
      const best = hits.reduce((top, row) => ((RANK[row.role] || 0) > (RANK[top.role] || 0) ? row : top), hits[0]);
      const hosts = hits.filter((row) => row.role === "host");
      if (hosts.length > 1) return { review: true };
      if (hosts.length === 1 && hits.some((row) => row.role !== "host")) return { review: true };
      if ((RANK[best.role] || 0) > 0 && hits.length === 1) return { row: best, review: false };
      return { review: true };
    }
  }
  return { review: false };
}

/**
 * Restore a creator only from a trusted owner id, or from one account whose email
 * matches the stored owner email and whose device still holds the circle edit key.
 * Several possible creators are flagged, not guessed.
 */
export function reconcileCreator(input: {
  ownerId?: string;
  ownerEmail?: string;
  accountId?: string;
  accountEmail?: string;
  matchingAccounts: number;
  hasEditKey: boolean;
}): { ownerId: string; review: boolean; host: boolean } {
  const ownerId = (input.ownerId || "").trim();
  const accountId = (input.accountId || "").trim();
  if (ownerId && accountId && ownerId === accountId) return { ownerId, review: false, host: true };
  if (ownerId && accountId && ownerId !== accountId) return { ownerId, review: false, host: false };
  const email = (input.ownerEmail || "").trim().toLowerCase();
  const accountEmail = (input.accountEmail || "").trim().toLowerCase();
  if (!accountId || !email || email !== accountEmail) return { ownerId: "", review: false, host: false };
  if (input.matchingAccounts !== 1) return { ownerId: "", review: true, host: false };
  if (!input.hasEditKey) return { ownerId: "", review: false, host: false };
  return { ownerId: accountId, review: false, host: true };
}
