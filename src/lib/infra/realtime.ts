export const REALTIME_PROVIDER = "cloudflare-realtimekit";
export const PRESENTER_PRESET = "webinar_presenter";
export const VIEWER_PRESET = "webinar_viewer";
export const REALTIME_API = "https://api.cloudflare.com/client/v4";
export const REALTIME_WEBHOOK_KEY_URL = "https://api.realtime.cloudflare.com/.well-known/webhooks.json";

const PRODUCE = new Set(["ALLOWED", "CAN_REQUEST", "NOT_ALLOWED"]);

export type Produce = "ALLOWED" | "CAN_REQUEST" | "NOT_ALLOWED" | "";

export type PresetPermission = {
  name: string;
  viewType: string;
  acceptProduction: boolean | null;
  kick: boolean | null;
  audio: Produce;
  video: Produce;
  screenshare: Produce;
};

export type ListedPreset = { id: string; name: string };

export function cloudflareFailure(body: unknown) {
  const errors = body && typeof body === "object" && Array.isArray((body as { errors?: unknown }).errors)
    ? (body as { errors: { message?: unknown; code?: unknown }[] }).errors
    : [];
  const first = errors[0];
  const raw = typeof first?.message === "string" ? first.message : "";
  const message = raw.replace(/bearer\s+\S+/gi, "Bearer [redacted]").replace(/\s+/g, " ").trim().slice(0, 180);
  const code = typeof first?.code === "number" ? first.code : 0;
  return { message, code };
}

export function readPresetList(body: unknown): ListedPreset[] {
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return [];
  const list: ListedPreset[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const name = typeof (item as { name?: unknown }).name === "string" ? (item as { name: string }).name.trim() : "";
    const id = typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id.trim() : "";
    if (name && id) list.push({ id, name });
  }
  return list;
}

function produceOf(value: unknown): Produce {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  return PRODUCE.has(text) ? text as Produce : "";
}

function boolOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

/** Reads one Fetch-preset response. Permissions are not on the list endpoint. */
export function readPresetPermission(body: unknown, fallbackName = ""): PresetPermission | null {
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : null;
  const row = data && typeof data === "object" ? data as Record<string, unknown> : null;
  if (!row) return null;
  const permissions = row.permissions && typeof row.permissions === "object" ? row.permissions as Record<string, unknown> : null;
  const mediaSource = permissions?.media && typeof permissions.media === "object"
    ? permissions.media as Record<string, unknown>
    : row.media && typeof row.media === "object"
      ? row.media as Record<string, unknown>
      : null;
  const config = row.config && typeof row.config === "object" ? row.config as Record<string, unknown> : null;
  const mediaOf = (kind: string) => {
    const block = mediaSource?.[kind];
    if (!block || typeof block !== "object") return "" as Produce;
    return produceOf((block as { can_produce?: unknown }).can_produce);
  };
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : fallbackName;
  if (!name) return null;
  return {
    name,
    viewType: typeof config?.view_type === "string" ? config.view_type.trim().toUpperCase() : "",
    acceptProduction: boolOrNull(permissions?.can_accept_production_requests ?? row.can_accept_production_requests),
    kick: boolOrNull(permissions?.kick_participant ?? row.kick_participant),
    audio: mediaOf("audio"),
    video: mediaOf("video"),
    screenshare: mediaOf("screenshare"),
  };
}

export function judgeWebinarPresets(presenter: PresetPermission | null, viewer: PresetPermission | null) {
  if (!presenter || !viewer) {
    const names = [presenter ? "" : PRESENTER_PRESET, viewer ? "" : VIEWER_PRESET].filter(Boolean).join(" and ");
    return { ok: false as const, detail: `RealtimeKit did not return ${names}. No meeting was created.` };
  }
  const problems: string[] = [];
  if (presenter.viewType !== "WEBINAR") problems.push(`${PRESENTER_PRESET} view_type is ${presenter.viewType || "missing"}, not WEBINAR`);
  if (viewer.viewType !== "WEBINAR") problems.push(`${VIEWER_PRESET} view_type is ${viewer.viewType || "missing"}, not WEBINAR`);
  for (const kind of ["audio", "video", "screenshare"] as const) {
    if (presenter[kind] !== "ALLOWED") problems.push(`${PRESENTER_PRESET} ${kind} can_produce is ${presenter[kind] || "missing"}, not ALLOWED`);
    if (viewer[kind] !== "NOT_ALLOWED" && viewer[kind] !== "CAN_REQUEST") {
      problems.push(`${VIEWER_PRESET} ${kind} can_produce is ${viewer[kind] || "missing"}. Watch-only needs NOT_ALLOWED or CAN_REQUEST`);
    }
  }
  if (presenter.acceptProduction !== true) problems.push(`${PRESENTER_PRESET} can_accept_production_requests is not true`);
  if (viewer.acceptProduction !== false) problems.push(`${VIEWER_PRESET} can_accept_production_requests is not false`);
  if (viewer.kick !== false) problems.push(`${VIEWER_PRESET} kick_participant is ${viewer.kick === null ? "missing" : "true"}`);
  if (problems.length) {
    return { ok: false as const, detail: `RealtimeKit presets are not ready for this wedding. ${problems.join(". ")}. No meeting was created.` };
  }
  const viewerProduce = viewer.audio === "NOT_ALLOWED" ? "NOT_ALLOWED" : "CAN_REQUEST";
  return {
    ok: true as const,
    detail: `Cloudflare RealtimeKit accepted the token. ${PRESENTER_PRESET} can publish. ${VIEWER_PRESET} is ${viewerProduce} for camera, microphone, and screen share. No meeting was created.`,
  };
}

export function classifyRealtimeProbe(input: {
  status: number | null;
  note: string;
  code?: number;
  network?: boolean;
  presetVerdict?: { ok: boolean; detail: string } | null;
}) {
  const note = input.note.replace(/\s+/g, " ").trim().slice(0, 180);
  const noted = note ? ` ${note}` : "";
  if (input.network || input.status == null) {
    return { ok: false as const, detail: "Cloudflare RealtimeKit could not be reached. No meeting was created." };
  }
  if (input.status === 401 || input.code === 1000) {
    return { ok: false as const, detail: `Cloudflare rejected the API token.${noted} No meeting was created.` };
  }
  if (input.code === 9109) {
    return { ok: false as const, detail: `Cloudflare rejected this token (9109). It was not treated as a Realtime Admin token.${noted} No meeting was created.` };
  }
  if (input.status === 403) {
    return { ok: false as const, detail: `This token does not have Realtime permission for the saved account (${input.code || 403}). Realtime Admin or Realtime is required.${noted} No meeting was created.` };
  }
  if (input.status === 404) {
    return { ok: false as const, detail: `That RealtimeKit app was not found.${noted} No meeting was created.` };
  }
  if (input.status !== 200) {
    return { ok: false as const, detail: `Cloudflare RealtimeKit refused the token (HTTP ${input.status}).${noted} No meeting was created.` };
  }
  if (!input.presetVerdict) {
    return { ok: false as const, detail: "The token was accepted, but preset permissions were not read. No meeting was created." };
  }
  return input.presetVerdict.ok
    ? { ok: true as const, detail: input.presetVerdict.detail }
    : { ok: false as const, detail: input.presetVerdict.detail };
}

export function presetForRole(role: string) {
  const value = role.trim().toLowerCase();
  if (value === "host" || value === "cohost") return PRESENTER_PRESET;
  if (value === "guest" || value === "family") return VIEWER_PRESET;
  return "";
}

export function meetingCreateBody(title: string) {
  return { title: title.trim().slice(0, 180) || "Wedding ceremony" };
}

export function participantCreateBody(name: string, presetName: string, customParticipantId: string) {
  return {
    name: name.trim().slice(0, 80) || "Guest",
    preset_name: presetName,
    custom_participant_id: customParticipantId.trim().slice(0, 80),
  };
}

export function recordingStartBody(meetingId: string) {
  return { meeting_id: meetingId };
}

export function recordingStopBody() {
  return { action: "stop" as const };
}

export function meetingEndBody() {
  return { status: "INACTIVE" as const };
}

function dataOf(body: unknown) {
  return body && typeof body === "object" ? (body as { data?: unknown }).data : null;
}

export function readMeetingId(body: unknown) {
  const data = dataOf(body);
  const id = data && typeof data === "object" ? (data as { id?: unknown }).id : "";
  return typeof id === "string" ? id.trim() : "";
}

/** Add Participant returns `token`. The client SDK option is named separately. */
export function readParticipantToken(body: unknown) {
  const data = dataOf(body);
  if (!data || typeof data !== "object") return "";
  const row = data as { token?: unknown; authToken?: unknown };
  const token = typeof row.token === "string" ? row.token : typeof row.authToken === "string" ? row.authToken : "";
  return token.trim();
}

export function readRecordingStart(body: unknown) {
  const data = dataOf(body);
  if (!data || typeof data !== "object") return { id: "", status: "" };
  const row = data as { id?: unknown; status?: unknown };
  return {
    id: typeof row.id === "string" ? row.id.trim() : "",
    status: typeof row.status === "string" ? row.status.trim().toUpperCase() : "",
  };
}

export function sameActiveMeeting(row: { slug?: string; ceremony_id?: string; status?: string; meeting_id?: string } | null, slug: string, ceremonyId: string) {
  if (!row?.meeting_id) return false;
  return row.slug === slug && row.ceremony_id === ceremonyId && row.status !== "ended" && row.status !== "inactive";
}

export type RealtimeWebhook = {
  event: string;
  meetingId: string;
  recordingId: string;
  status: string;
  downloadUrl: string;
  duration: number | null;
};

function textOf(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseRealtimeWebhook(body: unknown): RealtimeWebhook | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const event = textOf(row.event);
  if (!event) return null;
  const meeting = row.meeting && typeof row.meeting === "object" ? row.meeting as Record<string, unknown> : null;
  const recording = row.recording && typeof row.recording === "object" ? row.recording as Record<string, unknown> : null;
  const meetingId = textOf(meeting?.id) || textOf(row.meetingId) || textOf(recording?.meetingId);
  const recordingId = textOf(recording?.id) || textOf(recording?.recordingId) || textOf(row.recordingId);
  const status = textOf(recording?.status).toUpperCase();
  const downloadUrl = textOf(recording?.downloadUrl);
  const durationRaw = recording?.recordingDuration;
  const duration = typeof durationRaw === "number" && Number.isFinite(durationRaw) ? Math.max(0, Math.floor(durationRaw)) : null;
  return { event, meetingId, recordingId, status, downloadUrl, duration };
}

export function webhookPublicKey(body: unknown) {
  const data = dataOf(body);
  if (!data || typeof data !== "object") return "";
  const key = (data as { publicKey?: unknown }).publicKey;
  return typeof key === "string" && key.includes("BEGIN PUBLIC KEY") ? key : "";
}

function pemToDer(pem: string) {
  const body = pem.replace(/-----BEGIN PUBLIC KEY-----/g, "").replace(/-----END PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function signatureBytes(value: string) {
  const cleaned = value.trim().replace(/\s+/g, "");
  if (!cleaned) return null;
  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/** RSA-SHA256 over the raw body. The signed bytes are not reserialized JSON. */
export async function verifyRealtimeSignature(publicKeyPem: string, signatureB64: string, raw: Uint8Array) {
  const signature = signatureBytes(signatureB64);
  if (!signature || !publicKeyPem.includes("BEGIN PUBLIC KEY") || raw.byteLength === 0) return false;
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      pemToDer(publicKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new ArrayBuffer(raw.byteLength);
    new Uint8Array(signed).set(raw);
    const proof = new ArrayBuffer(signature.byteLength);
    new Uint8Array(proof).set(signature);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, proof, signed);
  } catch {
    return false;
  }
}

export function shouldOpenDeviceCamera(mode: string) {
  return mode !== "realtimekit";
}

export function guestPublishAllowed(preset: PresetPermission | null) {
  if (!preset) return false;
  return preset.audio === "ALLOWED" || preset.video === "ALLOWED" || preset.screenshare === "ALLOWED";
}
