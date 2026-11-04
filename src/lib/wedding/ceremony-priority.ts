import type { FunctionEvent } from "./types.ts";

const THREAD_GAP_MS = 15 * 60 * 1000;

/** Highest-priority upcoming wedding-day ceremony. Never keyed on a ceremony name. */
export function featuredCeremony<T extends Pick<FunctionEvent, "date" | "time" | "live">>(
  events: T[],
  weddingDate: string,
  todayKey: string,
): T | undefined {
  if (events.length === 0) return undefined;
  const upcoming = events.filter((item) => !item.date || item.date >= todayKey);
  const pool = upcoming.length > 0 ? upcoming : events;
  return [...pool].sort((a, b) => ceremonyRank(b, weddingDate) - ceremonyRank(a, weddingDate) || `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];
}

function ceremonyRank(item: Pick<FunctionEvent, "date" | "live">, weddingDate: string) {
  let score = 0;
  if (item.live) score += 100;
  if (weddingDate && item.date === weddingDate) score += 40;
  return score;
}

export function messageStamp(iso?: string) {
  if (!iso) return Number.NaN;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
}

/** Consecutive text from one sender stays one thread until the sender, day, or a long pause changes. */
export function sameMessageThread(
  previous: { author?: string; authorId?: string; at?: string } | undefined,
  current: { author?: string; authorId?: string; at?: string },
  sameSender: boolean,
  previousBlocked: boolean,
) {
  if (!previous || !sameSender || previousBlocked) return false;
  const left = messageStamp(previous.at);
  const right = messageStamp(current.at);
  if (Number.isFinite(left) && Number.isFinite(right)) {
    if (right - left > THREAD_GAP_MS) return false;
    if (new Date(left).toDateString() !== new Date(right).toDateString()) return false;
  }
  return true;
}
