/** Rules for a disappearing private reply. No I/O. */

export const WHISPER_MS = 60_000;
export const WHISPER_MAX = 500;

export type WhisperRow = {
  id: string;
  slug: string;
  parentPostId: string;
  parentExcerpt: string;
  replyTo?: string;
  senderKey: string;
  senderName: string;
  recipientKey: string;
  recipientName: string;
  body: string;
  createdAt: number;
  firstRevealedAt: number | null;
  expiresAt: number | null;
  deletedAt: number | null;
};

export type WhisperView = {
  id: string;
  parentPostId: string;
  parentExcerpt: string;
  replyTo?: string;
  senderName: string;
  recipientName: string;
  mine: boolean;
  otherKey: string;
  collapsed: boolean;
  body: string;
  unopened: boolean;
  expiresAt: number | null;
  remainingMs: number | null;
};

export function cleanWhisperBody(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, WHISPER_MAX);
}

/** What this member is allowed to see. Everyone else gets null, including hosts. */
export function whisperFor(row: WhisperRow, memberKey: string, now: number): WhisperView | null {
  if (!memberKey || row.deletedAt) return null;
  if (row.expiresAt != null && row.expiresAt <= now) return null;
  const mine = row.senderKey === memberKey;
  const theirs = row.recipientKey === memberKey;
  if (!mine && !theirs) return null;
  const revealed = row.firstRevealedAt != null;
  const collapsed = theirs && !revealed;
  return {
    id: row.id,
    parentPostId: row.parentPostId,
    parentExcerpt: collapsed ? "" : row.parentExcerpt,
    replyTo: row.replyTo,
    senderName: row.senderName,
    recipientName: row.recipientName,
    mine,
    otherKey: mine ? row.recipientKey : row.senderKey,
    collapsed,
    body: collapsed ? "" : row.body,
    unopened: mine && !revealed,
    expiresAt: revealed ? row.expiresAt : null,
    remainingMs: revealed && row.expiresAt ? Math.max(0, row.expiresAt - now) : null,
  };
}

export function clockLabel(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
