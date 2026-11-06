import { getSql } from "@/lib/db";
import { weddingDataSql } from "@/lib/developer/core-route.server";
import { assessInfrastructure, effectiveFlag } from "@/lib/infra/core";
import { decideLive, realtimeAuthorizationHeader } from "@/lib/infra/live";
import {
  cloudflareFailure,
  meetingCreateBody,
  meetingEndBody,
  parseRealtimeWebhook,
  participantCreateBody,
  readMeetingId,
  readParticipantToken,
  readRecordingStart,
  REALTIME_API,
  recordingStartBody,
  recordingStopBody,
  sameActiveMeeting,
  verifyRealtimeSignature,
  webhookPublicKey,
  REALTIME_WEBHOOK_KEY_URL,
} from "@/lib/infra/realtime";
import { appendReplay, canCopyRecording, RECORDING_COPY_LIMIT, recordingObjectKey, replayMessage } from "@/lib/infra/realtime-recording";
import { putR2Object } from "@/lib/infra/r2-sign";
import { resolvedInfraEnv } from "@/lib/infra/resolved-env.server";

type SessionInput = {
  action: string;
  slug: string;
  ceremonyId: string;
  memberKey: string;
  name: string;
  peerId: string;
};

type MeetingRow = {
  slug: string;
  ceremony_id: string;
  meeting_id: string;
  host_peer: string;
  status: string;
  recording_id: string;
  recording_status: string;
  object_key: string;
  replay_id: string;
  participant_count: number;
  recording_error: string;
};

function safeError(status: number, body: unknown) {
  const failure = cloudflareFailure(body);
  const note = failure.message ? ` ${failure.message}` : "";
  return `Cloudflare RealtimeKit refused the request (HTTP ${status}${failure.code ? `, ${failure.code}` : ""}).${note}`.replace(/\s+/g, " ").trim();
}

async function memberRole(slug: string, memberKey: string) {
  if (!slug || !memberKey) return "";
  try {
    const rows = await (await weddingDataSql())<{ role: string }>`select role from circle_members where slug = ${slug} and member_key = ${memberKey} limit 1`;
    return String(rows[0]?.role || "");
  } catch {
    return "";
  }
}

async function ceremonyName(slug: string, ceremonyId: string) {
  try {
    const rows = await (await weddingDataSql())<{ payload: unknown }>`select payload from circles where slug = ${slug} limit 1`;
    const payload = rows[0]?.payload;
    const wedding = typeof payload === "string" ? JSON.parse(payload) as { functions?: { id?: string; name?: string }[] } : payload as { functions?: { id?: string; name?: string }[] } | null;
    const functions = Array.isArray(wedding?.functions) ? wedding.functions : [];
    if (!functions.length) return ceremonyId ? "Ceremony" : "";
    const found = functions.find((item) => item?.id === ceremonyId);
    return found ? String(found.name || "Ceremony").slice(0, 80) : "";
  } catch {
    return "";
  }
}

async function providerState() {
  const resolved = await resolvedInfraEnv();
  const assessed = assessInfrastructure(resolved.env).providers.find((item) => item.id === "livestream");
  let enabled = false;
  try {
    const rows = await (await getSql())<{ enabled: boolean }>`select enabled from infra_flags where key = ${"livestream"} limit 1`;
    enabled = Boolean(rows[0]?.enabled);
  } catch {
    enabled = false;
  }
  return {
    env: resolved.env,
    ready: effectiveFlag(enabled, assessed?.state || "not_configured"),
  };
}

function kitConfig(env: Record<string, string | undefined>) {
  const account = (env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const appId = (env.CLOUDFLARE_REALTIME_APP_ID || "").trim();
  const authorization = realtimeAuthorizationHeader(env.CLOUDFLARE_REALTIME_API_TOKEN || "");
  return { account, appId, authorization };
}

function kitUrl(account: string, appId: string, path: string) {
  return `${REALTIME_API}/accounts/${encodeURIComponent(account)}/realtime/kit/${encodeURIComponent(appId)}${path}`;
}

async function kitFetch(authorization: string, url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, payload };
}

async function findMeeting(slug: string, ceremonyId: string) {
  const rows = await (await getSql())<MeetingRow>`
    select slug, ceremony_id, meeting_id, host_peer, status, recording_id, recording_status, object_key, replay_id, participant_count, recording_error
    from realtime_meetings where slug = ${slug} and ceremony_id = ${ceremonyId} limit 1
  `;
  return rows[0] || null;
}

async function findByMeeting(meetingId: string) {
  if (!meetingId) return null;
  const rows = await (await getSql())<MeetingRow & { ceremony_name: string }>`
    select slug, ceremony_id, meeting_id, host_peer, status, recording_id, recording_status, object_key, replay_id, participant_count, recording_error
    from realtime_meetings where meeting_id = ${meetingId} limit 1
  `;
  return rows[0] || null;
}

export async function runRealtimeSession(input: SessionInput) {
  const slug = input.slug.trim();
  const ceremonyId = input.ceremonyId.trim();
  const action = input.action.trim().toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || !/^[A-Za-z0-9_-]{1,80}$/.test(ceremonyId)) {
    return { ok: false as const, error: "That wedding or ceremony was refused. No meeting was created." };
  }
  const role = await memberRole(slug, input.memberKey);
  const named = await ceremonyName(slug, ceremonyId);
  if (!named) return { ok: false as const, error: "That ceremony is not in this wedding. No meeting was created." };
  const { env, ready } = await providerState();
  if (action === "status" || action === "watch") {
    const decision = decideLive({ providerReady: ready, action: action === "watch" ? "watch" : "status", role, member: Boolean(role) });
    if (!decision.ok) return decision;
    if (!ready) return { ok: true as const, mode: "in-app" as const };
    const row = await findMeeting(slug, ceremonyId);
    const live = sameActiveMeeting(row, slug, ceremonyId);
    if (action === "status") return { ok: true as const, mode: "realtimekit" as const, live, meetingId: live ? row?.meeting_id || "" : "" };
    if (!live || !row) return { ok: true as const, mode: "realtimekit" as const, waiting: true as const };
    return issueToken(env, row, input.name, input.memberKey, "webinar_viewer");
  }
  if (action === "start") {
    if (!role) return { ok: false as const, error: "This livestream is private to the wedding." };
    if (!ready) return { ok: true as const, mode: "in-app" as const };
    const decision = decideLive({ providerReady: true, action: "create", role, member: true });
    if (!decision.ok) return decision;
    const kit = kitConfig(env);
    if (!kit.account || !kit.appId || !kit.authorization) {
      return { ok: false as const, error: "Cloudflare RealtimeKit is not configured. No meeting was created." };
    }
    let row = await findMeeting(slug, ceremonyId);
    if (row && row.recording_id && !row.object_key && row.recording_status && row.recording_status !== "ERRORED" && row.recording_status !== "UPLOADED") {
      return { ok: false as const, error: "The previous recording is still being stored. No second meeting was created." };
    }
    if (!sameActiveMeeting(row, slug, ceremonyId)) {
      const created = await kitFetch(kit.authorization, kitUrl(kit.account, kit.appId, "/meetings"), "POST", meetingCreateBody(`${named} · ${slug}`));
      const meetingId = readMeetingId(created.payload);
      if (!created.ok || !meetingId) return { ok: false as const, error: safeError(created.status, created.payload) };
      const sql = await getSql();
      if (!row) {
        try {
          await sql`
            insert into realtime_meetings (slug, ceremony_id, meeting_id, host_peer, status)
            values (${slug}, ${ceremonyId}, ${meetingId}, ${input.peerId.slice(0, 80)}, ${"active"})
          `;
        } catch {
          const again = await findMeeting(slug, ceremonyId);
          if (!again?.meeting_id) return { ok: false as const, error: "The meeting could not be saved. No participant was added." };
          row = again;
        }
      } else {
        await sql`
          update realtime_meetings
          set meeting_id = ${meetingId}, host_peer = ${input.peerId.slice(0, 80)}, status = ${"active"},
              recording_id = ${""}, recording_status = ${""}, recording_error = ${""},
              object_key = ${""}, replay_id = ${""}, participant_count = ${0}, updated_at = now()
          where slug = ${slug} and ceremony_id = ${ceremonyId}
        `;
        row = await findMeeting(slug, ceremonyId);
      }
      row = await findMeeting(slug, ceremonyId);
    } else if (row && input.peerId && row.host_peer !== input.peerId) {
      await (await getSql())`update realtime_meetings set host_peer = ${input.peerId.slice(0, 80)}, updated_at = now() where slug = ${slug} and ceremony_id = ${ceremonyId}`;
      row = await findMeeting(slug, ceremonyId);
    }
    if (!row?.meeting_id) return { ok: false as const, error: "The meeting was not stored. No participant was added." };
    const issued = await issueToken(env, row, input.name, input.memberKey, "webinar_presenter");
    if (!issued.ok) return issued;
    if (!row.recording_id) await startRecording(env, row);
    return issued;
  }
  if (action === "stop") {
    const decision = decideLive({ providerReady: ready, action: "stop", role, member: Boolean(role) });
    if (!decision.ok) return decision;
    const row = await findMeeting(slug, ceremonyId);
    if (!row?.meeting_id || !ready) return { ok: true as const, mode: "in-app" as const, stopped: true as const };
    const kit = kitConfig(env);
    if (row.recording_id && row.recording_status !== "UPLOADED") {
      const stopped = await kitFetch(kit.authorization, kitUrl(kit.account, kit.appId, `/recordings/${encodeURIComponent(row.recording_id)}`), "PUT", recordingStopBody());
      if (!stopped.ok) {
        await (await getSql())`update realtime_meetings set recording_error = ${safeError(stopped.status, stopped.payload).slice(0, 300)}, updated_at = now() where meeting_id = ${row.meeting_id}`;
      }
    }
    const ended = await kitFetch(kit.authorization, kitUrl(kit.account, kit.appId, `/meetings/${encodeURIComponent(row.meeting_id)}`), "PATCH", meetingEndBody());
    if (!ended.ok) return { ok: false as const, error: safeError(ended.status, ended.payload) };
    await (await getSql())`update realtime_meetings set status = ${"ended"}, updated_at = now() where meeting_id = ${row.meeting_id}`;
    return { ok: true as const, mode: "realtimekit" as const, stopped: true as const };
  }
  return { ok: false as const, error: "That live action is not available." };
}

async function issueToken(env: Record<string, string | undefined>, row: MeetingRow, name: string, memberKey: string, preset: string) {
  const kit = kitConfig(env);
  const added = await kitFetch(
    kit.authorization,
    kitUrl(kit.account, kit.appId, `/meetings/${encodeURIComponent(row.meeting_id)}/participants`),
    "POST",
    participantCreateBody(name, preset, memberKey),
  );
  const token = readParticipantToken(added.payload);
  if (!added.ok || !token) return { ok: false as const, error: safeError(added.status, added.payload) };
  return { ok: true as const, mode: "realtimekit" as const, authToken: token, meetingId: row.meeting_id };
}

async function startRecording(env: Record<string, string | undefined>, row: MeetingRow) {
  const kit = kitConfig(env);
  const started = await kitFetch(kit.authorization, kitUrl(kit.account, kit.appId, "/recordings"), "POST", recordingStartBody(row.meeting_id));
  const recording = readRecordingStart(started.payload);
  const sql = await getSql();
  if (!started.ok || !recording.id) {
    await sql`update realtime_meetings set recording_error = ${safeError(started.status, started.payload).slice(0, 300)}, updated_at = now() where meeting_id = ${row.meeting_id} and recording_id = ${""}`;
    return;
  }
  await sql`
    update realtime_meetings
    set recording_id = ${recording.id}, recording_status = ${recording.status || "INVOKED"}, recording_error = ${""}, updated_at = now()
    where meeting_id = ${row.meeting_id} and recording_id = ${""}
  `;
}

let cachedKey: { pem: string; at: number } | null = null;

async function publicKey() {
  if (cachedKey && Date.now() - cachedKey.at < 60 * 60 * 1000) return cachedKey.pem;
  const response = await fetch(REALTIME_WEBHOOK_KEY_URL, { signal: AbortSignal.timeout(8000) });
  const body = await response.json().catch(() => null);
  const pem = webhookPublicKey(body);
  if (!response.ok || !pem) return "";
  cachedKey = { pem, at: Date.now() };
  return pem;
}

export async function acceptRealtimeWebhook(raw: Uint8Array, signature: string, deliveryId: string) {
  if (!deliveryId || deliveryId.length > 200) return { status: 401 as const, error: "Missing webhook delivery id." };
  const pem = await publicKey();
  const valid = pem ? await verifyRealtimeSignature(pem, signature, raw) : false;
  if (!valid) return { status: 401 as const, error: "The webhook signature was rejected." };
  let parsed: ReturnType<typeof parseRealtimeWebhook> = null;
  try {
    parsed = parseRealtimeWebhook(JSON.parse(new TextDecoder().decode(raw)));
  } catch {
    return { status: 400 as const, error: "The webhook body could not be read." };
  }
  if (!parsed) return { status: 400 as const, error: "The webhook event was not recognized." };
  const sql = await getSql();
  const inserted = await sql<{ delivery_id: string }>`
    insert into realtime_webhook_deliveries (delivery_id, event_name)
    values (${deliveryId}, ${parsed.event.slice(0, 80)})
    on conflict (delivery_id) do nothing
    returning delivery_id
  `;
  if (!inserted[0]) return { status: 200 as const, duplicate: true as const };
  const row = await findByMeeting(parsed.meetingId);
  if (!row) return { status: 200 as const, ignored: true as const };
  if (parsed.event === "meeting.participantJoined") {
    await sql`update realtime_meetings set participant_count = participant_count + 1, updated_at = now() where meeting_id = ${row.meeting_id}`;
  } else if (parsed.event === "meeting.participantLeft") {
    await sql`update realtime_meetings set participant_count = greatest(participant_count - 1, 0), updated_at = now() where meeting_id = ${row.meeting_id}`;
  } else if (parsed.event === "meeting.ended") {
    await sql`update realtime_meetings set status = ${"ended"}, updated_at = now() where meeting_id = ${row.meeting_id}`;
  } else if (parsed.event === "meeting.started" && !row.recording_id) {
    const { env, ready } = await providerState();
    if (ready) {
      await startRecording(env, row);
      const again = await findByMeeting(row.meeting_id);
      if (!again?.recording_id) {
        await sql`delete from realtime_webhook_deliveries where delivery_id = ${deliveryId}`;
        return { status: 500 as const, error: "Recording did not start. Nothing was stored." };
      }
    }
  } else if (parsed.event === "recording.statusUpdate") {
    const recordingId = parsed.recordingId || row.recording_id;
    if (parsed.duration == null) {
      await sql`
        update realtime_meetings
        set recording_status = ${parsed.status || row.recording_status},
            recording_id = case when ${recordingId} <> '' then ${recordingId} else recording_id end,
            updated_at = now()
        where meeting_id = ${row.meeting_id}
      `;
    } else {
      await sql`
        update realtime_meetings
        set recording_status = ${parsed.status || row.recording_status},
            recording_id = case when ${recordingId} <> '' then ${recordingId} else recording_id end,
            recording_seconds = ${parsed.duration},
            updated_at = now()
        where meeting_id = ${row.meeting_id}
      `;
    }
    if (parsed.status === "UPLOADED") {
      const stored = await storeUploadedRecording({ ...row, recording_id: recordingId }, parsed.downloadUrl, parsed.duration);
      if (!stored.ok) {
        await sql`update realtime_meetings set recording_error = ${stored.error.slice(0, 300)}, updated_at = now() where meeting_id = ${row.meeting_id}`;
        await sql`delete from realtime_webhook_deliveries where delivery_id = ${deliveryId}`;
        return { status: 500 as const, error: "The recording was not stored." };
      }
    } else if (parsed.status === "ERRORED") {
      await sql`update realtime_meetings set recording_error = ${"RealtimeKit reported a recording error. Nothing was stored."}, updated_at = now() where meeting_id = ${row.meeting_id}`;
    }
  }
  return { status: 200 as const };
}

async function storeUploadedRecording(row: MeetingRow, downloadUrl: string, seconds: number | null) {
  if (row.object_key && row.replay_id) return { ok: true as const };
  if (!downloadUrl.startsWith("https://")) return { ok: false as const, error: "The recording download link was missing. Nothing was stored." };
  const current = await findByMeeting(row.meeting_id);
  if (current?.object_key && current.replay_id) return { ok: true as const };
  let bytes: Uint8Array;
  try {
    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return { ok: false as const, error: `The recording download was refused (HTTP ${response.status}). Nothing was stored.` };
    const length = Number(response.headers.get("content-length") || 0);
    if (length && !canCopyRecording(length)) {
      return { ok: false as const, error: `The recording is larger than ${RECORDING_COPY_LIMIT} bytes. Nothing was stored.` };
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { ok: false as const, error: "The recording download did not finish. Nothing was stored." };
  }
  if (!canCopyRecording(bytes.byteLength)) {
    return { ok: false as const, error: `The recording is larger than ${RECORDING_COPY_LIMIT} bytes. Nothing was stored.` };
  }
  const resolved = await resolvedInfraEnv();
  const env = resolved.env;
  const accountId = env.R2_ACCOUNT_ID?.trim() || "";
  const bucket = env.R2_BUCKET?.trim() || "";
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim() || "";
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim() || "";
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    return { ok: false as const, error: "Private storage is not configured. The recording was not stored." };
  }
  const key = recordingObjectKey(row.slug, row.recording_id || row.meeting_id);
  const saved = await putR2Object({ accountId, bucket, key, accessKeyId, secretAccessKey, jurisdiction: env.R2_JURISDICTION, contentType: "video/mp4", body: bytes });
  if (!saved.ok) return { ok: false as const, error: `The recording was downloaded but private storage refused it. ${saved.detail}`.slice(0, 300) };
  const sql = await getSql();
  await sql`
    insert into r2_media (object_key, slug, purpose, mime, bytes)
    values (${key}, ${row.slug}, ${"chat"}, ${"video/mp4"}, ${bytes.byteLength})
    on conflict (object_key) do nothing
  `;
  const ceremony = await ceremonyName(row.slug, row.ceremony_id);
  const message = replayMessage({ recordingId: row.recording_id || row.meeting_id, ceremonyName: ceremony || "the ceremony", objectKey: key, seconds });
  const replay = await insertReplay(row.slug, message);
  if (!replay.ok) {
    await sql`update realtime_meetings set object_key = ${key}, recording_error = ${replay.error.slice(0, 300)}, updated_at = now() where meeting_id = ${row.meeting_id}`;
    return { ok: false as const, error: replay.error };
  }
  await sql`
    update realtime_meetings
    set object_key = ${key}, replay_id = ${message.id}, recording_error = ${""}, recording_status = ${"UPLOADED"}, updated_at = now()
    where meeting_id = ${row.meeting_id}
  `;
  if (row.host_peer) {
    await sql`
      insert into circle_live_chat (slug, host_peer, peer_id, name, body)
      select ${row.slug}, ${row.host_peer}, ${"replay"}, ${"Wedding Circle"}, ${message.text}
      where not exists (
        select 1 from circle_live_chat where slug = ${row.slug} and host_peer = ${row.host_peer} and body = ${message.text}
      )
    `.catch(() => undefined);
  }
  return { ok: true as const };
}

async function insertReplay(slug: string, message: ReturnType<typeof replayMessage>) {
  try {
    const sql = await weddingDataSql();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const rows = await sql<{ payload: unknown; rev: number }>`select payload, coalesce((payload->>'rev')::int, 0) as rev from circles where slug = ${slug} limit 1`;
      const row = rows[0];
      if (!row) return { ok: false as const, error: "The wedding chat could not be found. The recording was stored without a replay message." };
      const wedding = typeof row.payload === "string" ? JSON.parse(row.payload) as { chats?: unknown; rev?: number } : row.payload as { chats?: unknown; rev?: number };
      const appended = appendReplay(Array.isArray(wedding.chats) ? wedding.chats as { id?: string; messages?: { id?: string }[] }[] : [], message);
      if (appended.duplicate) return { ok: true as const };
      const next = { ...wedding, chats: appended.chats, rev: Number(row.rev || wedding.rev || 0) + 1 };
      const saved = await sql<{ slug: string }>`
        update circles set payload = ${JSON.stringify(next)}::jsonb, updated_at = now()
        where slug = ${slug} and coalesce((payload->>'rev')::int, 0) = ${Number(row.rev || 0)}
        returning slug
      `;
      if (saved[0]) return { ok: true as const };
    }
    return { ok: false as const, error: "The replay message could not be saved. The recording is stored." };
  } catch {
    return { ok: false as const, error: "The replay message could not be saved. The recording is stored." };
  }
}
