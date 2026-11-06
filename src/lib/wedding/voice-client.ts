import type RealtimeKitClient from "@cloudflare/realtimekit";
import { freshPhase, type VoicePhase } from "./voice-chat";

export type VoiceCreds = {
  slug: string;
  memberKey: string;
  editKey: string;
  name: string;
};

type Connection = {
  meeting: RealtimeKitClient;
  creds: VoiceCreds;
  id: string;
  heartbeat: number;
  refresh: number;
  reporting: Promise<unknown>;
  audio: Map<string, { track: MediaStreamTrack; element: HTMLAudioElement }>;
};

const listeners = new Set<() => void>();
let snapshot = freshPhase();
let active: Connection | null = null;
let chain: Promise<void> = Promise.resolve();
let guards = false;

function patch(partial: Partial<VoicePhase>) {
  snapshot = { ...snapshot, ...partial };
  for (const listener of listeners) listener();
}

export function voiceSnapshot() {
  return snapshot;
}

export function subscribeVoice(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function enqueue(task: () => Promise<void>) {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

function report(connection: Connection) {
  connection.reporting = connection.reporting.then(async () => {
    if (active !== connection) return;
    const { beatVoiceSession } = await import("./voice-chat.functions");
    if (active !== connection) return;
    await beatVoiceSession({ data: {
      ...connection.creds, connectionId: connection.id, publish: connection.meeting.self.audioEnabled,
    } });
  }).catch(() => undefined);
}

function reportLeave(creds: VoiceCreds, connectionId: string) {
  void import("./voice-chat.functions").then(({ leaveVoiceRoom }) => leaveVoiceRoom({
    data: { ...creds, connectionId },
  })).catch(() => undefined);
}

function removeAudio(connection: Connection, id: string) {
  const entry = connection.audio.get(id);
  if (!entry) return;
  entry.element.pause();
  entry.element.srcObject = null;
  entry.element.remove();
  connection.audio.delete(id);
}

function syncAudio(connection: Connection) {
  const joined = connection.meeting.participants.joined;
  for (const [id, entry] of connection.audio) {
    const peer = joined.get(id);
    if (!snapshot.speakerEnabled || !peer?.audioEnabled || peer.audioTrack !== entry.track) removeAudio(connection, id);
  }
  if (!snapshot.speakerEnabled) return;
  for (const peer of joined.values()) {
    const track = peer.audioTrack;
    if (!peer.audioEnabled || !track || track.readyState === "ended") continue;
    let entry = connection.audio.get(peer.id);
    if (!entry) {
      const element = document.createElement("audio");
      element.autoplay = true;
      element.setAttribute("playsinline", "true");
      element.srcObject = new MediaStream([track]);
      document.body.appendChild(element);
      entry = { track, element };
      connection.audio.set(peer.id, entry);
    }
    void entry.element.play().catch(() => {
      if (active === connection && snapshot.speakerEnabled) {
        patch({ error: "Tap the speaker again so this browser can play voices." });
      }
    });
  }
}

async function close(error = "") {
  const connection = active;
  active = null;
  patch({ ...freshPhase(), error });
  if (!connection) return;
  window.clearInterval(connection.heartbeat);
  window.clearTimeout(connection.refresh);
  for (const id of connection.audio.keys()) removeAudio(connection, id);
  connection.meeting.self.audioTrack?.stop();
  reportLeave(connection.creds, connection.id);
  await connection.meeting.leave().catch(() => undefined);
}

async function connect(creds: VoiceCreds): Promise<Connection | null> {
  if (active?.creds.slug === creds.slug && active.creds.memberKey === creds.memberKey && active.meeting.self.roomJoined) return active;
  if (active) await close();
  patch({ connecting: true, error: "" });
  let meeting: RealtimeKitClient | undefined;
  let id = "";
  try {
    const { issueVoiceToken } = await import("./voice-chat.functions");
    const issued = await issueVoiceToken({ data: creds });
    if (!issued.ok || !("token" in issued) || !issued.token || !issued.connectionId) {
      patch({ ...freshPhase(), error: "error" in issued && issued.error ? issued.error : "Voice chat isn't available in this wedding yet." });
      return null;
    }
    id = issued.connectionId;
    const { default: RealtimeKit } = await import("@cloudflare/realtimekit");
    meeting = await RealtimeKit.init({ authToken: issued.token, defaults: { audio: false, video: false } });
    await meeting.join();
    if (!meeting.self.roomJoined) throw new Error("Voice room did not join");
    const connection: Connection = { meeting, creds, id, heartbeat: 0, refresh: 0, reporting: Promise.resolve(), audio: new Map() };
    active = connection;
    const sync = () => { if (active === connection) syncAudio(connection); };
    meeting.participants.joined.on("participantJoined", sync);
    meeting.participants.joined.on("participantLeft", sync);
    meeting.participants.joined.on("audioUpdate", sync);
    meeting.self.on("roomJoined", sync);
    meeting.self.on("audioUpdate", ({ audioEnabled }) => {
      if (active !== connection) return;
      patch({ micEnabled: audioEnabled });
      report(connection);
    });
    meeting.self.on("roomLeft", () => {
      if (active === connection) void enqueue(() => active === connection ? close("Voice chat disconnected. Tap Mic or Speaker to join again.") : Promise.resolve());
    });
    connection.heartbeat = window.setInterval(() => report(connection), 10_000);
    connection.refresh = window.setTimeout(() => void enqueue(async () => {
      if (active !== connection) return;
      const { micEnabled, speakerEnabled } = snapshot;
      await close();
      if (!micEnabled && !speakerEnabled) return;
      const next = await connect(creds);
      if (!next) return;
      patch({ speakerEnabled, connecting: false });
      syncAudio(next);
      if (micEnabled && document.visibilityState !== "hidden") await setMic(next, true);
    }), Math.max(30, issued.expiresIn - 180) * 1000);
    return connection;
  } catch {
    if (id) reportLeave(creds, id);
    meeting?.self.audioTrack?.stop();
    await meeting?.leave().catch(() => undefined);
    patch({ ...freshPhase(), error: "Voice chat could not connect. Try again in a moment." });
    return null;
  }
}

async function setMic(connection: Connection, enabled: boolean) {
  try {
    if (enabled && document.visibilityState !== "hidden") await connection.meeting.self.enableAudio();
    else await connection.meeting.self.disableAudio();
    const micEnabled = connection.meeting.self.audioEnabled;
    patch({ micEnabled, connecting: false, error: enabled && !micEnabled && document.visibilityState !== "hidden"
      ? "The microphone did not start. Check browser permissions and try again." : "" });
    report(connection);
  } catch (error) {
    const message = error instanceof Error && /NotAllowed|PermissionDenied/i.test(error.name)
      ? "Allow microphone access in your browser to talk."
      : "The microphone could not be changed. Try again.";
    if (!enabled || connection.meeting.self.audioEnabled || !snapshot.speakerEnabled) await close(message);
    else patch({ micEnabled: false, connecting: false, error: message });
  }
}

export function setVoiceMic(on: boolean, creds: VoiceCreds) {
  return enqueue(async () => {
    if (!on) {
      if (!snapshot.speakerEnabled) await close();
      else if (active) await setMic(active, false);
      return;
    }
    const connection = await connect(creds);
    if (connection) await setMic(connection, true);
  });
}

export function setVoiceSpeaker(on: boolean, creds: VoiceCreds) {
  return enqueue(async () => {
    if (!on && !snapshot.micEnabled) {
      await close();
      return;
    }
    const connection = on ? await connect(creds) : active;
    if (!connection) return;
    patch({ speakerEnabled: on, connecting: false, error: "" });
    syncAudio(connection);
  });
}

export function hangupVoice(_event: "leave" | "wedding" | "logout" = "leave") {
  return enqueue(() => close());
}

export function installVoiceGuards() {
  if (guards || typeof window === "undefined") return;
  guards = true;
  window.addEventListener("pagehide", () => {
    active?.meeting.self.audioTrack?.stop();
    void hangupVoice();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    active?.meeting.self.audioTrack?.stop();
    void enqueue(async () => {
      if (!snapshot.speakerEnabled) await close();
      else if (active) await setMic(active, false);
    });
  });
}
