/** Free weddings store 500 MB. Premium, after a verified purchase, stores 10 GB. */
export const FREE_STORAGE_BYTES = 500 * 1024 * 1024;
export const PREMIUM_STORAGE_BYTES = 10 * 1024 * 1024 * 1024;
export const FREE_STORAGE_LABEL = "500 MB";
export const PREMIUM_STORAGE_LABEL = "10 GB";
export const PREMIUM_PRICE_LABEL = "₹499";

export const FREE_STORAGE_MESSAGE =
  "This wedding can store 500 MB on the free plan. That file was not added, and nothing already saved was removed. Premium is a one-time ₹499 for 10 GB. Files already saved stay available.";

type MediaCarrier = {
  id?: string;
  slug?: string;
  illustrated?: boolean;
  payment?: { status?: string; verified?: boolean };
  cover?: string;
  coverVideo?: string;
  posts?: Array<{ images?: string[]; videoLabel?: string; videos?: { src?: string }[]; audio?: { src?: string } }>;
  chats?: Array<{ messages?: Array<{ image?: string; video?: string }> }>;
  beforeNotes?: Array<{ images?: string[]; video?: string }>;
};

function sampleCircle(wedding: MediaCarrier | null | undefined) {
  return Boolean(wedding && (wedding.illustrated || wedding.id === "lila-nico" || wedding.slug === "lila-nico"));
}

/** Premium requires a server-verified payment or redeemed voucher. */
export function isPremiumWedding(wedding: MediaCarrier | null | undefined) {
  if (!wedding || sampleCircle(wedding)) return false;
  return verifiedPurchase(wedding.payment);
}

function verifiedPurchase(payment?: { status?: string; verified?: boolean } | null) {
  return Boolean(payment && payment.verified === true && payment.status !== "failed");
}

function restoredPurchase<T extends { status?: string; verified?: boolean }>(payment: T): T {
  if (payment.verified === true && payment.status !== "paid" && payment.status !== "failed") {
    return { ...payment, status: "paid", verified: true };
  }
  return payment;
}

/**
 * Keep a verified one-time purchase. A newer verified record wins.
 * An unverified, failed, or pending record never replaces a verified one.
 * A verified record whose status was later overwritten is restored to paid.
 */
export function retainVerifiedPayment<T extends { status?: string; verified?: boolean }>(
  current: T | null | undefined,
  incoming: T | null | undefined,
): T | null | undefined {
  const nextIncoming = incoming ? restoredPurchase(incoming) : incoming;
  const nextCurrent = current ? restoredPurchase(current) : current;
  if (nextIncoming && verifiedPurchase(nextIncoming)) return nextIncoming;
  if (nextCurrent && verifiedPurchase(nextCurrent)) return nextCurrent;
  return incoming ?? current;
}

/** Server copy of a circle. A client save cannot grant or erase a verified purchase. */
export function lockServerPayment<T extends { status?: string; verified?: boolean }>(
  current: T | null | undefined,
  incoming: T | null | undefined,
): T | null | undefined {
  if (current && current.verified === true && current.status !== "failed") {
    return { ...current, status: "paid", verified: true };
  }
  if (current && current.verified === true && current.status === "failed") return current;
  if (!incoming) return incoming;
  return { ...incoming, verified: false };
}

/** A real wedding that has not had a verified purchase. The sample is not restricted. */
export function planLimited(wedding: MediaCarrier | null | undefined) {
  return Boolean(wedding) && !sampleCircle(wedding) && !isPremiumWedding(wedding);
}

export function storageLimitBytes(wedding: MediaCarrier | null | undefined) {
  return isPremiumWedding(wedding) ? PREMIUM_STORAGE_BYTES : FREE_STORAGE_BYTES;
}

export function storageMessage(wedding: MediaCarrier | null | undefined) {
  if (isPremiumWedding(wedding)) {
    return "This wedding can store 10 GB. That file was not added, and nothing already saved was removed. Files already saved stay available.";
  }
  return FREE_STORAGE_MESSAGE;
}

export function storedMediaBytes(value?: string) {
  if (!value || !value.startsWith("data:")) return 0;
  const comma = value.indexOf(",");
  if (comma < 0) return 0;
  return Math.floor((value.length - comma - 1) * 0.75);
}

export function weddingStorageBytes(wedding: MediaCarrier | null | undefined) {
  if (!wedding) return 0;
  let total = 0;
  const add = (value?: string) => {
    total += storedMediaBytes(value);
  };
  add(wedding.cover);
  add(wedding.coverVideo);
  for (const post of wedding.posts ?? []) {
    post.images?.forEach(add);
    add(post.videoLabel);
    post.videos?.forEach((clip) => add(clip.src));
    add(post.audio?.src);
  }
  for (const chat of wedding.chats ?? []) {
    for (const message of chat.messages ?? []) {
      add(message.image);
      add(message.video);
    }
  }
  for (const note of wedding.beforeNotes ?? []) {
    note.images?.forEach(add);
    add(note.video);
  }
  return total;
}

export function overFreeStorage(used: number, extra = 0) {
  return used + extra > FREE_STORAGE_BYTES;
}

/** Block a new upload that would pass the allowance. Existing files are not removed. */
export function overPlanStorage(wedding: MediaCarrier | null | undefined, used: number, extra = 0) {
  if (sampleCircle(wedding)) return false;
  return used + extra > storageLimitBytes(wedding);
}
