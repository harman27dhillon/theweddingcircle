import { circleKey } from "@/lib/wedding/circle-key";
import { codesOf } from "@/lib/wedding/format";
import { memberKeyFor, rememberMemberKey } from "@/lib/wedding/member-key";
import { claimWeddingRole, registerWeddingAuthority, resolveWeddingRole } from "@/lib/wedding/roles.functions";
import { useWeddingStore } from "@/lib/wedding/store";
import type { Wedding } from "@/lib/wedding/types";

export type AuthorizedRole = "guest" | "family" | "cohost" | "host";

function emailOf() {
  return useWeddingStore.getState().account?.email ?? "";
}

function accountIdOf() {
  return useWeddingStore.getState().account?.id ?? "";
}

export async function confirmWeddingRole(slug: string, name: string, code: string) {
  const result = await claimWeddingRole({
    data: { slug, memberKey: memberKeyFor(slug), email: emailOf(), name, code },
  });
  if (result.ok) rememberMemberKey(slug, result.memberKey);
  return result;
}

export async function refreshWeddingRole(slug: string) {
  const result = await resolveWeddingRole({ data: { slug, memberKey: memberKeyFor(slug), email: emailOf(), accountId: accountIdOf() } });
  if (result.ok && result.role && result.memberKey) rememberMemberKey(slug, result.memberKey);
  return result;
}

export async function registerHostAuthority(wedding: Wedding) {
  const codes = codesOf(wedding);
  const result = await registerWeddingAuthority({
    data: {
      slug: wedding.slug,
      editKey: circleKey(wedding.slug),
      email: wedding.ownerEmail || emailOf(),
      name: wedding.hostName,
      memberKey: memberKeyFor(wedding.slug),
      accountId: accountIdOf(),
      familyCodes: codes.filter((item) => item.kind === "family").map((item) => item.code),
      guestCodes: codes.filter((item) => item.kind === "guest").map((item) => item.code),
    },
  });
  if (result.ok) rememberMemberKey(wedding.slug, result.memberKey);
  return result;
}

export function applyRole(weddingId: string, role: AuthorizedRole) {
  useWeddingStore.getState().applyAuthorizedRole(weddingId, role);
}
