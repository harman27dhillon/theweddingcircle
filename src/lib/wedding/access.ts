import { coupleAccessForPublish } from "./couple-access.ts";
import type { AccessRule, Role, Side, Wedding } from "@/lib/wedding/types";

export type AccessViewer = { name: string; role: Role; side?: Side } | null;

function norm(name: string) {
  return name.trim().toLowerCase();
}

export function canView(wedding: Pick<Wedding, "guests" | "functions">, viewer: AccessViewer, rule?: AccessRule, contentId?: string, author?: string): boolean {
  if (!rule || rule.kind === "all") return true;
  if (!viewer?.name.trim()) return false;
  if (viewer.role === "host" || viewer.role === "cohost") return true;
  if (author && norm(author) === norm(viewer.name)) return true;
  const guest = wedding.guests.find((item) => norm(item.name) === norm(viewer.name));
  if (guest?.blocked) return false;
  if (contentId && guest?.blockedIds?.includes(contentId)) return false;
  const names = (rule.names ?? []).map(norm);
  if (rule.kind === "people") return names.includes(norm(viewer.name));
  if (names.includes(norm(viewer.name))) return true;
  if (rule.kind === "ceremony") {
    const ceremonyId = rule.ceremonyId || contentId || "";
    if (guest?.allowCeremonies?.includes(ceremonyId)) return true;
    const fn = wedding.functions.find((item) => item.id === ceremonyId);
    if (!fn?.accessRule || fn.accessRule.kind === "ceremony") return false;
    return canView(wedding, viewer, fn.accessRule, fn.id);
  }
  const side = guest?.side ?? viewer.side;
  if (rule.kind === "bride") return side === "Bride" || side === "Both" || Boolean(guest?.allowBride);
  if (rule.kind === "groom") return side === "Groom" || side === "Both" || Boolean(guest?.allowGroom);
  return false;
}

export function redactWedding(wedding: Wedding, viewer: AccessViewer): Wedding {
  if (viewer && (viewer.role === "host" || viewer.role === "cohost")) return wedding;
  const keep = (rule?: AccessRule, id?: string, author?: string) => canView(wedding, viewer, rule, id, author);
  return {
    ...wedding,
    posts: wedding.posts.filter((post) => keep(post.accessRule, post.id, post.author)),
    beforeNotes: (wedding.beforeNotes ?? []).filter((item) => keep(item.accessRule, item.id, item.author)),
    functions: wedding.functions.filter((item) => keep(item.accessRule, item.id)),
    liveNotes: keep(wedding.liveAccess) ? wedding.liveNotes : [],
    liveAccess: keep(wedding.liveAccess) ? wedding.liveAccess : undefined,
    chats: viewer ? wedding.chats : [],
    mediaKey: undefined,
    postingCodes: [],
    payment: undefined,
    ownerEmail: undefined,
    enquiries: [],
    tasks: [],
    coupleAccess: coupleAccessForPublish(wedding.coupleAccess),
  };
}
