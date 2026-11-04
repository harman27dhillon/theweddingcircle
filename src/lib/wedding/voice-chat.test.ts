import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { jwtVerify } from "jose";
import {
  adminGrant,
  afterMicRequest,
  afterSpeakerToggle,
  freshVoice,
  hears,
  memberGrant,
  publishAllowed,
  roomName,
  sessionAfter,
  stripOpen,
  transmits,
  visibleMics,
} from "./voice-chat.ts";
import { voiceOn, type VoiceInput } from "./voice-chat.db.ts";
import { liveKitConfig, liveKitHttpOrigin, signVoiceJwt, speakersFromParticipants, type VoiceProvider } from "./voice-livekit.ts";

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
  await circle(store, slug, join);
  return sqlOf(store);
}

function input(slug: string, key: string, name: string, action: string, extra: Partial<VoiceInput> = {}): VoiceInput {
  return { slug, memberKey: key, editKey: "", name, action, publish: false, ...extra };
}

function provider(map: Record<string, string[]> = {}): VoiceProvider & { published: { room: string; identity: string; publish: boolean }[]; signed: string[] } {
  const published: { room: string; identity: string; publish: boolean }[] = [];
  const signed: string[] = [];
  return {
    configured: true,
    url: "wss://voice.example.test",
    published,
    signed,
    async signMember(identity: string, _name: string, room: string) {
      signed.push(`${room}:${identity}`);
      const grant = memberGrant(room);
      assert.equal(grant.roomAdmin, false);
      assert.equal(grant.canPublish, false);
      assert.equal(grant.canSubscribe, true);
      return `member.${identity}`;
    },
    async allowPublish(room: string, identity: string, publish: boolean) {
      published.push({ room, identity, publish });
      return { ok: true as const };
    },
    async speakers(room: string) {
      return { ok: true as const, identities: map[room] ?? [] };
    },
  };
}

const off = { configured: false, url: "", async signMember() { throw new Error("no"); }, async allowPublish() { return { ok: false as const, error: "no" }; }, async speakers() { return { ok: false as const, error: "no" }; } };

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

test("live microphone tracks ignore mute, screen share, and duplicate identities", () => {
  const ids = speakersFromParticipants({
    participants: [
      { identity: "guestkey1", tracks: [{ type: "AUDIO", source: "MICROPHONE", muted: false }] },
      { identity: "guestkey1", tracks: [{ type: "AUDIO", source: "MICROPHONE", muted: false }] },
      { identity: "hostkey01", tracks: [{ type: "AUDIO", source: "MICROPHONE", muted: true }] },
      { identity: "otherkey1", tracks: [{ type: 0, source: 4, muted: false }] },
      { identity: "videoonly", tracks: [{ type: "VIDEO", source: "CAMERA", muted: false }] },
    ],
  });
  assert.deepEqual(ids, ["guestkey1"]);
});

test("member tokens cannot administer the room", async () => {
  const secret = "test-secret-value";
  const grant = memberGrant("wc-voice-asha-rohan");
  const token = await signVoiceJwt("API_test", secret, "guestkey1", "Guest", grant, 60);
  const verified = await jwtVerify(token, new TextEncoder().encode(secret), { issuer: "API_test" });
  const video = verified.payload.video as { roomAdmin?: boolean; canPublish?: boolean; canSubscribe?: boolean; room?: string };
  assert.equal(verified.payload.sub, "guestkey1");
  assert.equal(video.roomAdmin, false);
  assert.equal(video.canPublish, false);
  assert.equal(video.canSubscribe, true);
  assert.equal(video.room, "wc-voice-asha-rohan");
  assert.equal(adminGrant("wc-voice-asha-rohan").roomJoin, false);
  assert.equal(adminGrant("wc-voice-asha-rohan").roomAdmin, true);
  assert.equal(token.includes(secret), false);
});

test("insecure or incomplete LiveKit settings stay off", () => {
  assert.equal(liveKitConfig({}).configured, false);
  assert.equal(liveKitConfig({ LIVEKIT_URL: "http://voice.example", LIVEKIT_API_KEY: "API_test", LIVEKIT_API_SECRET: "test-secret-value" }).configured, false);
  assert.equal(liveKitConfig({ LIVEKIT_URL: "ws://voice.example", LIVEKIT_API_KEY: "API_test", LIVEKIT_API_SECRET: "test-secret-value" }).configured, false);
  assert.equal(liveKitConfig({ LIVEKIT_URL: "wss://voice.example", LIVEKIT_API_KEY: "API_test", LIVEKIT_API_SECRET: "short" }).configured, false);
  const local = liveKitConfig({ LIVEKIT_URL: "ws://127.0.0.1:7880", LIVEKIT_API_KEY: "API_test", LIVEKIT_API_SECRET: "test-secret-value" });
  assert.equal(local.configured, true);
  const production = liveKitConfig({ APP_ENV: "production", LIVEKIT_URL: "ws://127.0.0.1:7880", LIVEKIT_API_KEY: "API_test", LIVEKIT_API_SECRET: "test-secret-value" });
  assert.equal(production.configured, false);
  assert.equal(liveKitHttpOrigin("wss://voice.example.test"), "https://voice.example.test");
});

test("nonmembers and other weddings cannot join or see microphones", async () => {
  const sql = await ready("asha-rohan", "approve");
  const closed = await voiceOn(sql, provider(), input("asha-rohan", "guestkey1", "Guest", "token"));
  assert.equal(closed.ok, false);
  const outsider = await voiceOn(sql, provider(), input("no-such-wedding", "guestkey1", "Guest", "token"));
  assert.equal(outsider.ok, false);
  const host = await voiceOn(sql, provider(), input("asha-rohan", "hostkey01", "Host", "token", { editKey: "edit-key-host-0001" }));
  assert.equal(host.ok, true);
  if (!host.ok || !("token" in host)) return;
  assert.equal(host.token, "member.hostkey01");
  assert.equal(host.room, roomName("asha-rohan"));
  assert.equal("roomAdmin" in host, false);

  const meera = await ready("meera-kabir");
  const bridge = provider({ [roomName("asha-rohan")]: ["hostkey01"], [roomName("meera-kabir")]: ["otherkey1"] });
  const roster = await voiceOn(sql, bridge, input("asha-rohan", "hostkey01", "Host", "roster", { editKey: "edit-key-host-0001" }));
  assert.equal(roster.ok, true);
  if (!roster.ok || !("people" in roster)) return;
  assert.deepEqual((roster.people ?? []).map((person) => person.memberKey), ["hostkey01"]);
  const elsewhere = await voiceOn(meera, bridge, input("meera-kabir", "otherkey1", "Other", "roster"));
  assert.equal(elsewhere.ok, true);
  if (!elsewhere.ok || !("people" in elsewhere)) return;
  assert.deepEqual((elsewhere.people ?? []).map((person) => person.memberKey), ["otherkey1"]);
});

test("several microphones appear once, then disappear when released", async () => {
  const sql = await ready("sangeet-night");
  const room = roomName("sangeet-night");
  const live = provider({ [room]: ["guestkey1", "guestkey1", "hostkey01"] });
  await voiceOn(sql, live, input("sangeet-night", "guestkey1", "Guest", "token"));
  await voiceOn(sql, live, input("sangeet-night", "hostkey01", "Host", "token", { editKey: "edit-key-host-0001" }));
  const shown = await voiceOn(sql, live, input("sangeet-night", "guestkey1", "Guest", "roster"));
  assert.equal(shown.ok, true);
  if (!shown.ok || !("people" in shown)) return;
  assert.deepEqual((shown.people ?? []).map((person) => person.memberKey), ["guestkey1", "hostkey01"]);
  const quiet = provider({ [room]: [] });
  const gone = await voiceOn(sql, quiet, input("sangeet-night", "guestkey1", "Guest", "roster"));
  assert.equal(gone.ok, true);
  if (!gone.ok || !("people" in gone)) return;
  assert.deepEqual(gone.people, []);
  const publish = await voiceOn(sql, live, input("sangeet-night", "guestkey1", "Guest", "publish", { publish: false }));
  assert.equal(publish.ok, true);
  assert.deepEqual(live.published.at(-1), { room, identity: "guestkey1", publish: false });
  const forged = await voiceOn(sql, live, input("sangeet-night", "guestkey1", "Guest", "publish", { publish: true }));
  assert.equal(forged.ok, true);
  assert.equal(live.published.at(-1)?.identity, "guestkey1");
});

test("missing LiveKit does not invent a connection", async () => {
  const sql = await ready("quiet-hall");
  const token = await voiceOn(sql, off, input("quiet-hall", "guestkey1", "Guest", "token"));
  assert.equal(token.ok, false);
  if (token.ok) return;
  assert.match(token.error ?? "", /isn't available/);
  const roster = await voiceOn(sql, off, input("quiet-hall", "guestkey1", "Guest", "roster"));
  assert.equal(roster.ok, true);
  if (!roster.ok || !("people" in roster)) return;
  assert.deepEqual(roster.people, []);
});

test("token requests are rate limited and leaving removes only that session", async () => {
  const sql = await ready("rate-limit-hall");
  const gate = provider();
  let blocked = false;
  for (let i = 0; i < 12; i += 1) {
    const result = await voiceOn(sql, gate, input("rate-limit-hall", "guestkey1", "Guest", "token"));
    if (!result.ok) blocked = true;
  }
  assert.equal(blocked, true);
  const left = await voiceOn(sql, gate, input("rate-limit-hall", "guestkey1", "Guest", "leave"));
  assert.equal(left.ok, true);
  const rows = await sql<{ member_key: string }>`select member_key from voice_sessions where slug = ${"rate-limit-hall"}`;
  assert.equal(rows.length, 0);
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
  const music = readFileSync(new URL("../../components/wedding/developer-music.tsx", import.meta.url), "utf8");
  assert.match(music, /music/i);
});
