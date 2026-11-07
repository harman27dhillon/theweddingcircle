import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  afterMicRequest,
  afterSpeakerToggle,
  freshVoice,
  hears,
  publishAllowed,
  sessionAfter,
  stripOpen,
  transmits,
  visibleMics,
} from "./voice-chat.ts";
import { voiceOn, type VoiceInput } from "./voice-chat.db.ts";
import { realtimeVoiceProvider, VOICE_PRESET, type VoiceProvider } from "./voice-realtime.ts";

function sqlOf(db: PGlite) {
  const run = async (text: string, params: unknown[] = []) => (await db.query(text, params)).rows as Record<string, unknown>[];
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = "";
    const params: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index < values.length) {
        params.push(values[index]);
        text += `$${params.length}`;
      }
    });
    return run(text, params);
  }) as {
    <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
    query<T>(text: string, params?: unknown[]): Promise<T[]>;
  };
  tag.query = run as typeof tag.query;
  return tag;
}

async function circle(db: PGlite, slug: string, join = "open") {
  await db.query(
    `insert into circles (slug, payload, edit_key) values ($1, $2::jsonb, $3)`,
    [slug, JSON.stringify({ slug, bride: "Asha", groom: "Rohan", posts: [], rev: 0, privacy: { join } }), "edit-key-host-0001"],
  );
}

function db() {
  return new PGlite();
}

async function ready(slug = "asha-rohan", join = "open") {
  const store = await db();
  await store.exec(`create table circles (
    slug text primary key,
    payload jsonb not null,
    edit_key text not null,
    updated_at timestamptz not null default now()
  )`);
  await store.exec(`create table circle_members (
    slug text not null, member_key text not null, email text not null,
    name text not null, role text not null, primary key (slug, member_key)
  )`);
  await store.exec(readFileSync(new URL("../../../migrations/0029_realtime_voice.sql", import.meta.url), "utf8"));
  await circle(store, slug, join);
  return sqlOf(store);
}

function input(slug: string, key: string, name: string, action: string, extra: Partial<VoiceInput> = {}): VoiceInput {
  return { slug, memberKey: key, editKey: "", name, action, publish: false, connectionId: "", ...extra };
}

const provider: VoiceProvider = {
  configured: true,
  providerApp: "test-app",
  async join(slug, _name, id) {
    return { ok: true, token: `token-for-${id}`, meetingId: `meeting-${slug}`, participantId: `participant-${id}` };
  },
  async leave() {},
};

test("a fresh voice session starts with mic and speaker off", () => {
  const prefs = freshVoice();
  assert.equal(prefs.micEnabled, false);
  assert.equal(prefs.speakerEnabled, false);
  assert.equal(sessionAfter({ slug: "asha-rohan", mic: true, speaker: true }, "refresh"), null);
  assert.equal(sessionAfter({ slug: "asha-rohan", mic: true, speaker: true }, "logout"), null);
  assert.equal(sessionAfter({ slug: "asha-rohan", mic: true, speaker: true }, "wedding"), null);
  assert.deepEqual(sessionAfter({ slug: "asha-rohan", mic: true, speaker: true }, "hide"), { slug: "asha-rohan", mic: false, speaker: true });
  assert.equal(publishAllowed("denied"), false);
  assert.equal(publishAllowed("granted"), true);
});

test("mic and speaker are independent", () => {
  const quiet = freshVoice();
  assert.equal(transmits(quiet), false);
  assert.equal(hears(quiet), false);
  const talk = afterMicRequest(quiet, "granted");
  assert.equal(talk.micEnabled, true);
  assert.equal(talk.speakerEnabled, false);
  assert.equal(transmits(talk), true);
  assert.equal(hears(talk), false);
  const listen = afterSpeakerToggle(quiet, true);
  assert.equal(listen.micEnabled, false);
  assert.equal(listen.speakerEnabled, true);
  assert.equal(transmits(listen), false);
  assert.equal(hears(listen), true);
  const both = afterSpeakerToggle(talk, true);
  assert.equal(transmits(both), true);
  assert.equal(hears(both), true);
  const denied = afterMicRequest(both, "denied");
  assert.equal(denied.micEnabled, false);
  assert.equal(denied.speakerEnabled, true);
  assert.match(denied.error, /denied/i);
});

test("microphone profiles hide when collapsed and ignore duplicates", () => {
  const people = visibleMics([
    { memberKey: "bbbbbbbb", name: "Bea" },
    { memberKey: "aaaaaaaa", name: "Ada" },
    { memberKey: "aaaaaaaa", name: "Ada again" },
  ]);
  assert.deepEqual(people.map((person) => person.memberKey), ["aaaaaaaa", "bbbbbbbb"]);
  assert.equal(stripOpen(false, people), false);
  assert.equal(stripOpen(true, people), true);
  assert.equal(stripOpen(true, []), false);
});

test("private wedding voice requires membership and keeps each connection scoped", async () => {
  const sql = await ready("asha-rohan", "approve");
  const guest = (action: string, extra?: Partial<VoiceInput>) => input("asha-rohan", "guestkey1", "Guest", action, extra);
  const host = (action: string, extra?: Partial<VoiceInput>) => input("asha-rohan", "hostkey01", "Host", action, { editKey: "edit-key-host-0001", ...extra });
  assert.equal((await voiceOn(sql, provider, guest("token"))).ok, false);
  assert.equal((await voiceOn(sql, provider, input("other-wedding", "hostkey01", "Host", "token"))).ok, false);

  const first = await voiceOn(sql, provider, host("token"));
  const second = await voiceOn(sql, provider, host("token"));
  assert.ok(first.ok && "connectionId" in first && first.connectionId);
  assert.ok(second.ok && "connectionId" in second && second.connectionId);
  assert.notEqual(first.connectionId, second.connectionId);
  const now = Date.now();
  await voiceOn(sql, provider, host("beat", { connectionId: first.connectionId, publish: true }), now);
  await voiceOn(sql, provider, host("beat", { connectionId: second.connectionId, publish: true }), now);
  const roster = await voiceOn(sql, provider, host("roster"), now);
  assert.deepEqual("people" in roster && roster.people, [{ memberKey: "hostkey01", name: "Host" }]);

  assert.equal((await voiceOn(sql, provider, guest("leave", { connectionId: second.connectionId }))).ok, false);
  const removed: string[] = [];
  const tracked = { ...provider, async leave(_meeting: string, id: string) { removed.push(id); } };
  await voiceOn(sql, tracked, host("leave", { connectionId: first.connectionId }), now);
  assert.deepEqual(removed, [`participant-${first.connectionId}`]);
  const remaining = await voiceOn(sql, provider, host("roster"), now);
  assert.deepEqual("people" in remaining && remaining.people, [{ memberKey: "hostkey01", name: "Host" }]);
  const expired = await voiceOn(sql, provider, host("roster"), now + 46_000);
  assert.deepEqual("people" in expired && expired.people, []);
});

test("RealtimeKit creates one separate voice meeting per wedding and gives each member a scoped token", async (context) => {
  const sql = await ready("voice-realtime");
  const token = "test-worker-token";
  const kit = realtimeVoiceProvider(sql, {
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_REALTIME_APP_ID: "voice-app", CLOUDFLARE_REALTIME_API_TOKEN: token,
  });
  let meetings = 0;
  const joined: string[] = [];
  const now = Date.now();
  context.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(resource));
    assert.equal(url.host, "api.cloudflare.com");
    assert.equal(init?.redirect, "manual");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
    if (url.pathname.endsWith("/meetings")) {
      meetings++;
      return Response.json({ success: true, data: { id: `meeting-${meetings}` } });
    }
    assert.match(url.pathname, /\/meetings\/meeting-[12]\/participants$/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.preset_name, VOICE_PRESET);
    assert.match(body.custom_participant_id, /^connection-[123]$/);
    assert.equal(Date.parse(body.token.expires_on), now + 15 * 60 * 1000);
    joined.push(url.pathname);
    return Response.json({ success: true, data: { id: body.custom_participant_id, token: "participant-token" } });
  });
  const [first, second] = await Promise.all([
    kit.join("voice-realtime", "Ada", "connection-1", now),
    kit.join("voice-realtime", "Bea", "connection-2", now),
  ]);
  assert.equal(first.ok && first.meetingId, "meeting-1");
  assert.equal(second.ok && second.meetingId, "meeting-1");
  const other = await kit.join("other-wedding", "Guest", "connection-3", now);
  assert.equal(other.ok && other.meetingId, "meeting-2");
  assert.equal(meetings, 2);
  assert.equal(joined.length, 3);
  assert.equal(JSON.stringify(first).includes(token), false);
});

test("missing RealtimeKit configuration does not invent a connection", async () => {
  const sql = await ready("quiet-hall");
  const result = await voiceOn(sql, realtimeVoiceProvider(sql, {}), input("quiet-hall", "guestkey1", "Guest", "token"));
  assert.equal(result.ok, false);
  assert.match("error" in result ? result.error ?? "" : "", /isn't available/);
});

test("chat replaces the music note and keeps the speaker anchored", () => {
  const feed = readFileSync(new URL("../../components/wedding/feed-screen.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../../components/wedding/home-screen.tsx", import.meta.url), "utf8");
  const live = readFileSync(new URL("../../components/wedding/live-screen.tsx", import.meta.url), "utf8");
  const more = readFileSync(new URL("../../components/wedding/plan-screen.tsx", import.meta.url), "utf8");
  const controls = readFileSync(new URL("../../components/wedding/chat-voice.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("./voice-client.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  assert.match(feed, /ChatVoiceControls/);
  assert.doesNotMatch(feed, /ThemeSpeaker|Choose background music|theme-tracks/);
  assert.doesNotMatch(home, /ChatVoiceControls/);
  assert.doesNotMatch(live, /ChatVoiceControls/);
  assert.doesNotMatch(more, /ChatVoiceControls/);
  assert.match(controls, /Turn microphone on/);
  assert.match(controls, /Turn speaker on/);
  assert.match(controls, /aria-pressed/);
  assert.match(controls, /data-noswipe/);
  assert.match(controls, /stopPropagation/);
  assert.equal(client.includes("localStorage"), false);
  assert.match(css, /\.voice-strip \{[\s\S]*position: absolute;/);
  assert.match(css, /\.theme-audio \{[\s\S]*right: 0\.55rem;/);
  assert.match(feed, /wc-notes-slot[\s\S]*wc-chat-tools[\s\S]*wc-voice-slot/);
  assert.match(css, /@media \(width >= 1100px\)[\s\S]*chat-voice-slot/);
});
