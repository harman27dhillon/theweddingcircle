import { googleMapsLink } from "@/lib/wedding/format";

export type InviteKind = "family" | "guest" | "bride" | "groom";

/** Details copied for one invitation. Missing fields are omitted, never invented. */
export type CeremonySnapshot = {
  id: string;
  name?: string;
  date?: string;
  time?: string;
  endTime?: string;
  venue?: string;
  address?: string;
  dress?: string;
  note?: string;
  mapsUrl?: string;
};

const TEXT: Array<[keyof Omit<CeremonySnapshot, "id" | "mapsUrl">, number]> = [
  ["name", 120],
  ["date", 32],
  ["time", 32],
  ["endTime", 32],
  ["venue", 160],
  ["address", 240],
  ["dress", 160],
  ["note", 2000],
];

export function snapshotCeremonies(functions: unknown, ids: readonly string[]): CeremonySnapshot[] {
  if (!Array.isArray(functions)) return [];
  const wanted = new Set(ids);
  const snaps: CeremonySnapshot[] = [];
  for (const item of functions) {
    if (!item || typeof item !== "object") continue;
    const fn = item as Record<string, unknown>;
    const id = typeof fn.id === "string" ? fn.id : "";
    if (!id || !wanted.has(id)) continue;
    const snap: CeremonySnapshot = { id };
    for (const [key, max] of TEXT) {
      const value = fn[key];
      if (typeof value !== "string") continue;
      const text = value.trim().slice(0, max);
      if (text) snap[key] = text;
    }
    if (typeof fn.mapsUrl === "string") {
      const maps = googleMapsLink(fn.mapsUrl);
      if (maps) snap.mapsUrl = maps;
    }
    snaps.push(snap);
  }
  return snaps;
}

export function canIssueInvite(
  actor: { host: boolean; family: boolean; bride: boolean; groom: boolean },
  kind: InviteKind,
): boolean {
  if (actor.host) return true;
  if (kind === "family" && actor.family) return true;
  if (kind === "bride" && actor.bride) return true;
  if (kind === "groom" && actor.groom) return true;
  return false;
}

export function invitationShareText(input: { bride: string; groom: string; ceremonies: CeremonySnapshot[]; url: string }): string {
  const lines = [`You're invited to ${input.bride.trim()} & ${input.groom.trim()}'s wedding.`];
  for (const item of input.ceremonies) {
    const bits = [item.name, item.date, item.time, item.venue].filter((part): part is string => Boolean(part));
    if (bits.length) lines.push(bits.join(" · "));
    if (item.note) lines.push(item.note);
  }
  lines.push("Open the invitation");
  lines.push(input.url);
  return lines.join("\n");
}

export function inviteAccessLabel(kind: InviteKind): string {
  if (kind === "family") return "family access";
  if (kind === "guest") return "guest access";
  if (kind === "bride") return "bride access";
  return "groom access";
}
