import { circleKey } from "./circle-key.ts";
import { isPremiumWedding } from "./plan.ts";
import { accountSenderId } from "./identity.ts";
import { SEED_ID } from "./seed.ts";
import type { Account, Membership, Wedding } from "./types.ts";

function isSample(w: { id?: string; slug?: string; illustrated?: boolean }) {
  return Boolean(w.illustrated) || w.id === SEED_ID || w.slug === "lila-nico";
}

export function landingUserKey(account: { email?: string; phone?: string } | null | undefined) {
  return accountSenderId(account);
}

/** The account that paid for a circle. Guests and co-hosts are not charged, and a circle key on this device is not a purchase. */
export function canPinLanding(account: Pick<Account, "email" | "phone"> | null | undefined, weddings: Wedding[], _memberships: Membership[]) {
  const email = (account?.email ?? "").trim().toLowerCase();
  if (!email || !landingUserKey(account)) return false;
  return weddings.some((wedding) => {
    if (isSample(wedding) || !isPremiumWedding(wedding)) return false;
    return Boolean(wedding.ownerEmail && wedding.ownerEmail.toLowerCase() === email);
  });
}

export function canEnterWedding(wedding: Wedding, account: { email?: string; name?: string } | null | undefined, memberships: { slug: string }[]) {
  if (!account || isSample(wedding)) return false;
  const email = (account.email ?? "").trim().toLowerCase();
  const name = (account.name ?? "").trim().toLowerCase();
  const owner = Boolean(email && wedding.ownerEmail && wedding.ownerEmail.toLowerCase() === email);
  if (wedding.disabled && !owner) return false;
  if (owner) return true;
  if (memberships.some((item) => item.slug === wedding.slug)) return true;
  if (circleKey(wedding.slug)) return true;
  if (!name) return false;
  return wedding.guests.some((guest) => guest.joined && !guest.blocked && guest.name.trim().toLowerCase() === name);
}

export function pinnedWeddingId(pins: Record<string, string> | undefined, account: { email?: string; phone?: string } | null | undefined) {
  const key = landingUserKey(account);
  if (!key) return "";
  return pins?.[key] ?? "";
}
