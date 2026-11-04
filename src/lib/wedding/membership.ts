const RANK: Record<string, number> = { guest: 1, family: 2, cohost: 3, host: 4 };

export function memberRank(role: string) {
  return RANK[role] ?? 0;
}

/** An existing role stays unless this request proved a higher code or the host edit key. */
export function nextMemberRole(current: string, requested: string, raise: boolean) {
  if (!memberRank(requested)) return current || "";
  if (!current) return requested;
  if (!raise) return current;
  return memberRank(requested) > memberRank(current) ? requested : current;
}

export type IdentityRow = { email: string; role: string; memberKey: string };

/**
 * Firebase proves who the caller is. Supabase decides the wedding role.
 * A claimed role is ignored. No row is created here.
 */
export function membershipFromIdentity(input: { email: string; rows: IdentityRow[]; claimedRole?: string }) {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) return { ok: false as const, reason: "The Firebase user has no email address, so no wedding membership was granted." };
  const rows = input.rows.filter((row) => row.email.trim().toLowerCase() === email && memberRank(row.role) > 0 && row.memberKey);
  if (rows.length === 0) return { ok: false as const, reason: "This Firebase user is not a member of this wedding." };
  if (rows.length > 1) return { ok: false as const, reason: "More than one membership uses this email. Nothing was granted." };
  const row = rows[0];
  return { ok: true as const, role: row.role, memberKey: row.memberKey, ignoredClaim: input.claimedRole || "" };
}
