/** Pure voice-chat rules. No network, no microphone, no secrets. */

export const TOKEN_TTL_SEC = 15 * 60;
export const ROSTER_CACHE_MS = 20_000;
export const SESSION_STALE_MS = 45_000;

export type VoicePrefs = {
  micEnabled: boolean;
  speakerEnabled: boolean;
};

export type VoicePhase = VoicePrefs & {
  connecting: boolean;
  error: string;
};

export type MicPermission = "granted" | "denied" | "prompt";

export type VoiceGrant = {
  roomJoin: boolean;
  room: string;
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
  roomAdmin: boolean;
  roomCreate: boolean;
  roomList: boolean;
  roomRecord: boolean;
};

export type RosterPerson = {
  memberKey: string;
  name: string;
};

const SLUG = /^[a-z0-9-]{3,80}$/;

export function freshVoice(): VoicePrefs {
  return { micEnabled: false, speakerEnabled: false };
}

export function freshPhase(): VoicePhase {
  return { ...freshVoice(), connecting: false, error: "" };
}

/** A new tab, refresh, or new Chat visit never restores a previous ON state. */
export function sessionAfter(
  state: { slug: string; mic: boolean; speaker: boolean } | null,
  event: "refresh" | "logout" | "wedding" | "leave" | "hide",
) {
  if (event === "hide" && state) return { ...state, mic: false };
  return null;
}

export function afterMicRequest(current: VoicePrefs, permission: MicPermission): VoicePhase {
  if (permission !== "granted") {
    return {
      ...current,
      micEnabled: false,
      connecting: false,
      error: "Microphone permission was denied. Chat still works. Allow the microphone in the browser settings to talk.",
    };
  }
  return { ...current, micEnabled: true, connecting: false, error: "" };
}

export function afterSpeakerToggle(current: VoicePrefs, enabled: boolean): VoicePrefs {
  return { ...current, speakerEnabled: enabled };
}

export function transmits(prefs: VoicePrefs) {
  return prefs.micEnabled;
}

export function hears(prefs: VoicePrefs) {
  return prefs.speakerEnabled;
}

export function cleanName(value: string, max = 80) {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function voiceSlug(value: string) {
  const slug = value.trim().toLowerCase();
  return SLUG.test(slug) ? slug : "";
}

export function roomName(slug: string) {
  return `wc-voice-${slug}`;
}

export function memberGrant(room: string): VoiceGrant {
  return {
    roomJoin: true,
    room,
    canPublish: false,
    canSubscribe: true,
    canPublishData: false,
    roomAdmin: false,
    roomCreate: false,
    roomList: false,
    roomRecord: false,
  };
}

/** Server-only. Never send this grant to a browser. */
export function adminGrant(room: string): VoiceGrant {
  return {
    roomJoin: false,
    room,
    canPublish: false,
    canSubscribe: false,
    canPublishData: false,
    roomAdmin: true,
    roomCreate: false,
    roomList: false,
    roomRecord: false,
  };
}

export function visibleMics(people: RosterPerson[]) {
  const seen = new Set<string>();
  const ordered = [...people].sort((a, b) => a.memberKey.localeCompare(b.memberKey) || a.name.localeCompare(b.name));
  const out: RosterPerson[] = [];
  for (const person of ordered) {
    if (!person.memberKey || seen.has(person.memberKey)) continue;
    seen.add(person.memberKey);
    out.push(person);
  }
  return out;
}

export function stripOpen(expanded: boolean, people: readonly unknown[]) {
  return expanded && people.length > 0;
}

export function samePeople(current: readonly RosterPerson[], next: readonly RosterPerson[]) {
  if (current.length !== next.length) return false;
  return current.every((person, index) => person.memberKey === next[index]?.memberKey && person.name === next[index]?.name);
}

export function publishAllowed(permission: MicPermission) {
  return permission === "granted";
}
