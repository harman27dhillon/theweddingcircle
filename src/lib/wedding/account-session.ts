import { circleKey, forgetCircleKey, rememberCircleKey } from "./circle-key.ts";
import { isSampleCircle } from "./format.ts";
import { accountSenderId } from "./identity.ts";
import { entryCodeFor, forgetEntryCode, forgetMemberKey, memberKeyFor, rememberEntryCode, rememberMemberKey } from "./member-key.ts";

const PARK = "wc-account-park";

type LooseWedding = {
  id?: string;
  slug?: string;
  ownerEmail?: string;
  illustrated?: boolean;
  fonts?: unknown;
};

type LooseMembership = { slug?: string; email?: string; name?: string; role?: string };

type SessionState = {
  weddings?: LooseWedding[];
  memberships?: LooseMembership[];
  landingPins?: Record<string, string>;
  notices?: { weddingId?: string }[];
  reports?: { weddingId?: string }[];
};

type Bundle = {
  weddings: LooseWedding[];
  memberships: LooseMembership[];
  pinId: string;
  circleKeys: Record<string, string>;
  memberKeys: Record<string, string>;
  entryCodes: Record<string, string>;
};

function storage() {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function readPark(): Record<string, Bundle> {
  const local = storage();
  if (!local) return {};
  try {
    const parsed = JSON.parse(local.getItem(PARK) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, Bundle>;
  } catch {
    return {};
  }
}

function writePark(all: Record<string, Bundle>) {
  const local = storage();
  if (!local) return;
  local.setItem(PARK, JSON.stringify(all));
}

function slugOf(wedding: LooseWedding) {
  return (wedding.slug || "").trim().toLowerCase();
}

function keysFor(slugs: string[], includeEdit: boolean) {
  const circleKeys: Record<string, string> = {};
  const memberKeys: Record<string, string> = {};
  const entryCodes: Record<string, string> = {};
  for (const slug of slugs) {
    const circle = circleKey(slug);
    const member = memberKeyFor(slug);
    const entry = entryCodeFor(slug);
    if (includeEdit && circle) circleKeys[slug] = circle;
    if (member) memberKeys[slug] = member;
    if (entry) entryCodes[slug] = entry;
  }
  return { circleKeys, memberKeys, entryCodes };
}

function releaseKeys(slugs: string[]) {
  for (const slug of slugs) {
    forgetCircleKey(slug);
    forgetMemberKey(slug);
    forgetEntryCode(slug);
  }
}

function restoreKeys(bundle: Bundle) {
  for (const [slug, key] of Object.entries(bundle.circleKeys ?? {})) {
    if (key) rememberCircleKey(slug, key);
  }
  for (const [slug, key] of Object.entries(bundle.memberKeys ?? {})) {
    if (key) rememberMemberKey(slug, key);
  }
  for (const [slug, code] of Object.entries(bundle.entryCodes ?? {})) {
    if (code) rememberEntryCode(slug, code);
  }
}

function mergeBundles(previous: Bundle | undefined, next: Bundle): Bundle {
  const weddings = new Map<string, LooseWedding>();
  for (const wedding of previous?.weddings ?? []) {
    const slug = slugOf(wedding);
    if (slug) weddings.set(slug, wedding);
  }
  for (const wedding of next.weddings) {
    const slug = slugOf(wedding);
    if (slug) weddings.set(slug, wedding);
  }
  const memberships = new Map<string, LooseMembership>();
  for (const item of [...(previous?.memberships ?? []), ...next.memberships]) {
    const slug = (item.slug || "").trim().toLowerCase();
    if (slug) memberships.set(slug, item);
  }
  return {
    weddings: [...weddings.values()],
    memberships: [...memberships.values()],
    pinId: next.pinId || previous?.pinId || "",
    circleKeys: { ...(previous?.circleKeys ?? {}), ...next.circleKeys },
    memberKeys: { ...(previous?.memberKeys ?? {}), ...next.memberKeys },
    entryCodes: { ...(previous?.entryCodes ?? {}), ...next.entryCodes },
  };
}

function saveBundle(id: string, bundle: Bundle) {
  if (!id || !bundle.weddings.length && !bundle.memberships.length && !bundle.pinId) return;
  const all = readPark();
  all[id] = mergeBundles(all[id], bundle);
  writePark(all);
}

function emailId(email: string) {
  const clean = email.trim().toLowerCase();
  if (!clean.includes("@")) return "";
  return accountSenderId({ email: clean, phone: "" });
}

/** Park private weddings off the signed-out screen. Database rows are not touched. */
export function parkSignedOutSession(state: SessionState, account: { email?: string; phone?: string } | null | undefined) {
  const weddings = state.weddings ?? [];
  const privateOnes = weddings.filter((wedding) => wedding && !isSampleCircle(wedding));
  const kept = weddings.filter((wedding) => wedding && isSampleCircle(wedding));
  const privateIds = new Set(privateOnes.map((wedding) => wedding.id).filter(Boolean));
  const slugs = privateOnes.map(slugOf).filter(Boolean);
  const id = accountSenderId(account);
  const memberships = state.memberships ?? [];
  if (id) {
    const pinId = state.landingPins?.[id] ?? "";
    saveBundle(id, {
      weddings: privateOnes,
      memberships: memberships.filter((item) => slugs.includes((item.slug || "").trim().toLowerCase())),
      pinId,
      ...keysFor(slugs, true),
    });
  } else {
    const owners = new Map<string, LooseWedding[]>();
    for (const wedding of privateOnes) {
      const owner = emailId(wedding.ownerEmail || "");
      if (!owner) continue;
      const list = owners.get(owner) ?? [];
      list.push(wedding);
      owners.set(owner, list);
    }
    for (const [owner, list] of owners) {
      const ownerSlugs = list.map(slugOf).filter(Boolean);
      saveBundle(owner, {
        weddings: list,
        memberships: memberships.filter((item) => ownerSlugs.includes((item.slug || "").trim().toLowerCase()) && emailId(item.email || "") === owner),
        pinId: "",
        ...keysFor(ownerSlugs, true),
      });
    }
    for (const item of memberships) {
      const member = emailId(item.email || "");
      const slug = (item.slug || "").trim().toLowerCase();
      const wedding = privateOnes.find((itemWedding) => slugOf(itemWedding) === slug);
      if (!member || !wedding || member === emailId(wedding.ownerEmail || "")) continue;
      saveBundle(member, {
        weddings: [wedding],
        memberships: [item],
        pinId: "",
        ...keysFor([slug], false),
      });
    }
  }
  releaseKeys(slugs);
  const landingPins = { ...(state.landingPins ?? {}) };
  if (id) delete landingPins[id];
  for (const [key, pinned] of Object.entries(landingPins)) {
    if (pinned && privateIds.has(pinned)) delete landingPins[key];
  }
  return {
    weddings: kept,
    memberships: [] as LooseMembership[],
    landingPins,
    notices: (state.notices ?? []).filter((notice) => !notice.weddingId || !privateIds.has(notice.weddingId)),
    reports: (state.reports ?? []).filter((report) => !report.weddingId || !privateIds.has(report.weddingId)),
  };
}

export function takeParkedSession(account: { email?: string; phone?: string } | null | undefined) {
  const id = accountSenderId(account);
  if (!id) return null;
  const all = readPark();
  const bundle = all[id];
  if (!bundle) return null;
  delete all[id];
  writePark(all);
  restoreKeys(bundle);
  return bundle;
}

export function mergeParkedWeddings<T extends LooseWedding>(current: T[], incoming: LooseWedding[]) {
  const map = new Map<string, T | LooseWedding>();
  for (const wedding of current) {
    const slug = slugOf(wedding);
    if (slug) map.set(slug, wedding);
  }
  for (const wedding of incoming) {
    if (!wedding || isSampleCircle(wedding)) continue;
    const slug = slugOf(wedding);
    if (!slug || map.has(slug)) continue;
    map.set(slug, wedding);
  }
  return [...map.values()] as T[];
}

export function mergeParkedMemberships<T extends LooseMembership>(current: T[], incoming: LooseMembership[]) {
  const map = new Map<string, T | LooseMembership>();
  for (const item of [...incoming, ...current]) {
    const slug = (item?.slug || "").trim().toLowerCase();
    if (slug) map.set(slug, item);
  }
  return [...map.values()].slice(0, 40) as T[];
}
