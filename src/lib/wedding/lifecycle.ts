/** Wedding lifetime and cloud-media retention. Pure so tests can move the clock without touching real weddings. */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const LIFESPAN_MS = 30 * DAY_MS;
export const REMINDER_WINDOW_MS = 7 * DAY_MS;
export const REMINDER_GAP_MS = 12 * 60 * 60 * 1000;
export const RETENTION_FEE_PAISE = 15000;
export const RETENTION_FEE_LABEL = "₹150";

export type Lifecycle = {
  createdAt: string;
  /** When the circle stops being an active wedding. Not moved by a media extension. */
  expiresAt: string;
  /** When cloud photos, videos, and chat are eligible for deletion. */
  mediaRetentionUntil: string;
};

export function formatUtc(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${formatted} UTC`;
}

/** Backfill only from a timestamp that already exists. Missing dates stay unset so nothing is expired by accident. */
export function backfillLifecycle(input: {
  createdAt?: string | null;
  expiresAt?: string | null;
  mediaRetentionUntil?: string | null;
  reliableCreatedAt?: string | null;
}): Lifecycle | null {
  const created = input.createdAt || input.reliableCreatedAt || "";
  const createdMs = Date.parse(created);
  if (!created || !Number.isFinite(createdMs)) return null;
  const existingExpiry = input.expiresAt ? Date.parse(input.expiresAt) : NaN;
  const expiresMs = Number.isFinite(existingExpiry) ? existingExpiry : createdMs + LIFESPAN_MS;
  const existingMedia = input.mediaRetentionUntil ? Date.parse(input.mediaRetentionUntil) : NaN;
  const mediaMs = Number.isFinite(existingMedia) ? existingMedia : expiresMs;
  return {
    createdAt: new Date(createdMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    mediaRetentionUntil: new Date(mediaMs).toISOString(),
  };
}

export function freshLifecycle(serverNowMs: number): Lifecycle {
  const life = backfillLifecycle({ createdAt: new Date(serverNowMs).toISOString() });
  if (!life) throw new Error("A server timestamp is required to open a wedding circle.");
  return life;
}

/** The slot that is due now. One slot each 12 hours, starting exactly 7 days before expiry. Missed slots are not burst later. */
export function currentReminderSlot(expiresAt: string, nowMs: number): string | null {
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return null;
  const start = expires - REMINDER_WINDOW_MS;
  if (nowMs < start || nowMs >= expires) return null;
  const index = Math.floor((nowMs - start) / REMINDER_GAP_MS);
  return new Date(start + index * REMINDER_GAP_MS).toISOString();
}

export function remindersOpen(life: Lifecycle, nowMs: number) {
  if (Date.parse(life.mediaRetentionUntil) > Date.parse(life.expiresAt)) return false;
  return currentReminderSlot(life.expiresAt, nowMs) !== null;
}

export function reminderCopy(weddingName: string, expiresAt: string) {
  const when = formatUtc(expiresAt);
  return {
    title: `${weddingName} expires soon`,
    body: `Your wedding circle expires soon. Save your photos and videos to your phone before ${when}, or extend cloud media retention for another 30 days for ${RETENTION_FEE_LABEL}.`,
  };
}

export function readyToDelete(life: Lifecycle, nowMs: number) {
  const expires = Date.parse(life.expiresAt);
  const media = Date.parse(life.mediaRetentionUntil);
  return Number.isFinite(expires) && Number.isFinite(media) && nowMs >= expires && nowMs >= media;
}

/** A confirmed payment adds 30 days of cloud media retention and does not move the wedding's active deadline. */
export function applyPaidExtension(life: Lifecycle, payment: { status: string; reference: string }, appliedReferences: string[]) {
  if (payment.status !== "paid" || !payment.reference || appliedReferences.includes(payment.reference)) {
    return { life, applied: false as const };
  }
  const base = Date.parse(life.mediaRetentionUntil);
  if (!Number.isFinite(base)) return { life, applied: false as const };
  return {
    life: { ...life, mediaRetentionUntil: new Date(base + LIFESPAN_MS).toISOString() },
    applied: true as const,
  };
}

export function retentionExtended(life: { expiresAt?: string | null; mediaRetentionUntil?: string | null } | null | undefined) {
  const expires = Date.parse(life?.expiresAt || "");
  const media = Date.parse(life?.mediaRetentionUntil || "");
  return Number.isFinite(expires) && Number.isFinite(media) && media > expires;
}

/** Guests stop at expiresAt. Hosts and co-hosts can still save media until mediaRetentionUntil. */
export function circleEntry(
  life: { expiresAt?: string | null; mediaRetentionUntil?: string | null } | null | undefined,
  role: string,
  nowMs: number,
): "open" | "guest-closed" | "ended" {
  const expires = Date.parse(life?.expiresAt || "");
  if (!Number.isFinite(expires)) return "open";
  const media = Date.parse(life?.mediaRetentionUntil || "");
  const retention = Number.isFinite(media) ? media : expires;
  if (nowMs >= retention) return "ended";
  if (nowMs >= expires && role !== "host" && role !== "cohost") return "guest-closed";
  return "open";
}

export function expiryPhase(
  life: { expiresAt?: string | null; mediaRetentionUntil?: string | null } | null | undefined,
  nowMs: number,
): "unset" | "active" | "soon" | "closed" | "ended" {
  const expires = Date.parse(life?.expiresAt || "");
  if (!Number.isFinite(expires)) return "unset";
  const media = Date.parse(life?.mediaRetentionUntil || "");
  const retention = Number.isFinite(media) ? media : expires;
  if (nowMs >= retention) return "ended";
  if (nowMs >= expires) return "closed";
  if (nowMs >= expires - REMINDER_WINDOW_MS) return "soon";
  return "active";
}
