import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appendReplay, canCopyRecording, recordingObjectKey, replayMessage } from "./realtime-recording.ts";
import {
  meetingCreateBody,
  meetingEndBody,
  parseRealtimeWebhook,
  participantCreateBody,
  readParticipantToken,
  readPresetPermission,
  recordingStartBody,
  recordingStopBody,
  sameActiveMeeting,
  verifyRealtimeSignature,
  webhookPublicKey,
} from "./realtime.ts";

const presenterBody = {
  success: true,
  data: {
    name: "webinar_presenter",
    config: { view_type: "WEBINAR" },
    permissions: {
      can_accept_production_requests: true,
      kick_participant: true,
      media: {
        audio: { can_produce: "ALLOWED" },
        video: { can_produce: "ALLOWED" },
        screenshare: { can_produce: "ALLOWED" },
      },
    },
  },
};

test("preset details are read from the documented permission fields", () => {
  const preset = readPresetPermission(presenterBody, "webinar_presenter");
  assert.equal(preset?.viewType, "WEBINAR");
  assert.equal(preset?.audio, "ALLOWED");
  assert.equal(preset?.acceptProduction, true);
  const viewer = readPresetPermission({
    success: true,
    data: {
      name: "webinar_viewer",
      config: { view_type: "WEBINAR" },
      permissions: {
        can_accept_production_requests: false,
        kick_participant: false,
        media: {
          audio: { can_produce: "NOT_ALLOWED" },
          video: { can_produce: "NOT_ALLOWED" },
          screenshare: { can_produce: "NOT_ALLOWED" },
        },
      },
    },
  });
  assert.equal(viewer?.video, "NOT_ALLOWED");
  assert.equal(viewer?.kick, false);
});

test("meeting creation is idempotent and roles get the documented presets", () => {
  assert.deepEqual(meetingCreateBody("Mehndi"), { title: "Mehndi" });
  assert.deepEqual(participantCreateBody("Asha", "webinar_presenter", "member-1"), {
    name: "Asha",
    preset_name: "webinar_presenter",
    custom_participant_id: "member-1",
  });
  assert.deepEqual(participantCreateBody("Guest", "webinar_viewer", "member-2").preset_name, "webinar_viewer");
  assert.deepEqual(recordingStartBody("meet-1"), { meeting_id: "meet-1" });
  assert.deepEqual(recordingStopBody(), { action: "stop" });
  assert.deepEqual(meetingEndBody(), { status: "INACTIVE" });
  const active = { slug: "asha-rohan", ceremony_id: "mehndi", status: "active", meeting_id: "meet-1" };
  assert.equal(sameActiveMeeting(active, "asha-rohan", "mehndi"), true);
  assert.equal(sameActiveMeeting(active, "asha-rohan", "other"), false);
  assert.equal(sameActiveMeeting({ ...active, status: "ended" }, "asha-rohan", "mehndi"), false);
  const token = readParticipantToken({ success: true, data: { id: "part-1", token: "secret-token" } });
  assert.equal(token, "secret-token");
  assert.equal(JSON.stringify(meetingCreateBody("Mehndi")).includes("secret-token"), false);
});

test("webhook signatures use the raw body and a second delivery is ignored by the stored id", async () => {
  const key = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const exported = await crypto.subtle.exportKey("spki", key.publicKey);
  const body = new Uint8Array(exported);
  const b64 = btoa(String.fromCharCode(...body));
  const pem = `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----`;
  const raw = new TextEncoder().encode(JSON.stringify({ event: "meeting.started", meeting: { id: "meet-1" } }));
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, raw));
  const signatureB64 = btoa(String.fromCharCode(...signature));
  assert.equal(await verifyRealtimeSignature(pem, signatureB64, raw), true);
  const changed = new Uint8Array(raw);
  changed[0] = changed[0] === 123 ? 32 : 123;
  assert.equal(await verifyRealtimeSignature(pem, signatureB64, changed), false);
  assert.equal(await verifyRealtimeSignature(pem, "not-base64", raw), false);
  const event = parseRealtimeWebhook({
    event: "recording.statusUpdate",
    meeting: { id: "meet-1" },
    recording: { id: "rec-1", status: "UPLOADED", downloadUrl: "https://example.com/file", recordingDuration: 12 },
  });
  assert.equal(event?.status, "UPLOADED");
  assert.equal(event?.recordingId, "rec-1");
  assert.equal(event?.duration, 12);
  assert.equal(webhookPublicKey({ data: { publicKey: pem } }), pem);
  const server = readFileSync(new URL("./realtime.server.ts", import.meta.url), "utf8");
  assert.match(server, /on conflict \(delivery_id\) do nothing/);
  assert.match(server, /The webhook signature was rejected/);
  assert.equal(server.includes("secret-token"), false);
});

test("a recording is stored once under the wedding and the replay is not duplicated", () => {
  const key = recordingObjectKey("asha-rohan", "rec-1");
  assert.equal(key.startsWith("weddings/asha-rohan/chat/"), true);
  assert.equal(key.includes("http"), false);
  const message = replayMessage({ recordingId: "rec-1", ceremonyName: "Mehndi", objectKey: key, seconds: 12 });
  assert.equal(message.video, `r2:${key}`);
  assert.equal(message.text.includes("http"), false);
  const first = appendReplay([{ id: "family", name: "Family", messages: [] }], message);
  assert.equal(first.duplicate, false);
  assert.equal(first.chats[0]?.messages?.length, 1);
  const second = appendReplay(first.chats, message);
  assert.equal(second.duplicate, true);
  assert.equal(second.chats[0]?.messages?.length, 1);
  assert.equal(canCopyRecording(1000), true);
  assert.equal(canCopyRecording(0), false);
  const live = readFileSync(new URL("./live.ts", import.meta.url), "utf8");
  assert.equal(live.toLowerCase().includes("r2"), false);
  const session = readFileSync(new URL("../../components/wedding/live-session.tsx", import.meta.url), "utf8");
  const start = session.slice(session.indexOf("async function startPreview"));
  assert.ok(start.includes("realtimeSession"));
  assert.ok(start.indexOf("realtimeSession") < start.indexOf("openDevices"));
  assert.match(session, /playsInline/);
});
