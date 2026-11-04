import { sessionAfter } from "./voice-chat";

export type VoiceCreds = {
  slug: string;
  memberKey: string;
  editKey: string;
  name: string;
};

export type VoiceSnapshot = {
  micEnabled: boolean;
  speakerEnabled: boolean;
  connecting: boolean;
  error: string;
};

type RemotePub = { kind: string; source?: string; setSubscribed: (on: boolean) => Promise<unknown> };
type RemoteParty = { audioTrackPublications: Map<string, RemotePub> };
type LiveRoom = {
  state: string;
  remoteParticipants: Map<string, RemoteParty>;
  localParticipant: { setMicrophoneEnabled: (on: boolean) => Promise<unknown> };
  startAudio: () => Promise<void>;
  canPlaybackAudio: boolean;
  on: (event: string, cb: (...args: never[]) => void) => void;
  removeAllListeners: () => void;
  disconnect: () => Promise<void>;
};

type Want = VoiceCreds & { mic: boolean; speaker: boolean };

const listeners = new Set<() => void>();
let snapshot: VoiceSnapshot = { micEnabled: false, speakerEnabled: false, connecting: false, error: "" };
let want: Want | null = null;
let room: LiveRoom | null = null;
let connectedSlug = "";
let chain: Promise<void> = Promise.resolve();
let refreshTimer = 0;
let beatTimer = 0;
let ignoreDisconnect = false;
let retries = 0;
let guards = false;
const elements = new Set<HTMLMediaElement>();

function emit(next: VoiceSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function voiceSnapshot() {
  return snapshot;
}

export function subscribeVoice(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function enqueue(task: () => Promise<void>) {
  const run = chain.then(task, task);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function patch(partial: Partial<VoiceSnapshot>) {
  emit({ ...snapshot, ...partial });
}

function denied(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: string }).name) : "";
  return name === "NotAllowedError" || name === "PermissionDeniedError" || name === "NotFoundError";
}

function detach() {
  for (const element of elements) {
    element.pause();
    element.srcObject = null;
    element.remove();
  }
  elements.clear();
}

function voicePublication(publication: RemotePub) {
  return publication.kind === "audio" && publication.source !== "screen_share_audio" && publication.source !== "screen_share";
}

async function applySpeaker(on: boolean, active: LiveRoom) {
  for (const participant of active.remoteParticipants.values()) {
    for (const publication of participant.audioTrackPublications.values()) {
      if (!voicePublication(publication)) continue;
      if (!on) publication.setSubscribed(false);
      else await publication.setSubscribed(true);
    }
  }
  if (!on) detach();
}

async function publishFlag(creds: VoiceCreds, publish: boolean) {
  const { allowVoicePublish } = await import("./voice-chat.functions");
  const once = await allowVoicePublish({ data: { ...creds, action: "publish", publish } }).catch(() => null);
  if (once && "ok" in once && once.ok) return true;
  if (!publish) return true;
  await new Promise((resolve) => setTimeout(resolve, 400));
  const twice = await allowVoicePublish({ data: { ...creds, action: "publish", publish } }).catch(() => null);
  return Boolean(twice && "ok" in twice && twice.ok);
}

function clearTimers() {
  window.clearTimeout(refreshTimer);
  window.clearInterval(beatTimer);
  refreshTimer = 0;
  beatTimer = 0;
}

async function tellLeave(creds: VoiceCreds | null) {
  if (!creds) return;
  const { leaveVoiceRoom } = await import("./voice-chat.functions");
  await leaveVoiceRoom({ data: { ...creds, action: "leave", publish: false } }).catch(() => undefined);
}

async function disconnect(event: "leave" | "wedding" | "logout" | "hide", keepError = false) {
  const creds = want;
  const next = sessionAfter(
    want ? { slug: want.slug, mic: want.mic, speaker: want.speaker } : null,
    event === "hide" ? "hide" : event === "wedding" ? "wedding" : event === "logout" ? "logout" : "leave",
  );
  const keepListening = event === "hide" && Boolean(next?.speaker && want);
  if (keepListening && want) want = { ...want, mic: false };
  else want = null;
  const active = room;
  if (!keepListening) {
    clearTimers();
    room = null;
    connectedSlug = "";
    if (active) {
      ignoreDisconnect = true;
      try { await active.localParticipant.setMicrophoneEnabled(false); } catch { /* already stopped */ }
      detach();
      active.removeAllListeners();
      await active.disconnect().catch(() => undefined);
      ignoreDisconnect = false;
      await tellLeave(creds);
    }
    emit({ micEnabled: false, speakerEnabled: false, connecting: false, error: keepError || event !== "leave" ? snapshot.error : "" });
    return;
  }
  if (active) {
    try { await active.localParticipant.setMicrophoneEnabled(false); } catch { /* already stopped */ }
    await publishFlag(creds!, false);
  }
  emit({ ...snapshot, micEnabled: false, connecting: false });
}

async function ensure(creds: VoiceCreds): Promise<LiveRoom | null> {
  if (room && connectedSlug === creds.slug && room.state === "connected") {
    want = { ...creds, mic: want?.mic ?? false, speaker: want?.speaker ?? false };
    return room;
  }
  if (room) await disconnect("wedding");
  const { issueVoiceToken } = await import("./voice-chat.functions");
  const issued = await issueVoiceToken({ data: { ...creds, action: "token", publish: false } });
  if (!issued || !("ok" in issued) || !issued.ok || !("token" in issued) || !issued.token || !issued.url) {
    const message = issued && "error" in issued && issued.error ? issued.error : "Voice chat isn't available in this wedding yet.";
    emit({ micEnabled: false, speakerEnabled: false, connecting: false, error: message });
    return null;
  }
  const sdk = await import("livekit-client");
  const next = new sdk.Room({
    dynacast: true,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  bind(next as unknown as LiveRoom, sdk.RoomEvent.TrackPublished, sdk.RoomEvent.TrackSubscribed, sdk.RoomEvent.TrackUnsubscribed, sdk.RoomEvent.Reconnected, sdk.RoomEvent.Disconnected, sdk.Track.Kind.Audio);
  try {
    await next.connect(issued.url, issued.token, { autoSubscribe: false });
  } catch {
    next.removeAllListeners();
    await next.disconnect().catch(() => undefined);
    emit({ micEnabled: false, speakerEnabled: false, connecting: false, error: "Voice chat could not connect. Try again in a moment." });
    return null;
  }
  room = next as unknown as LiveRoom;
  connectedSlug = creds.slug;
  retries = 0;
  want = { ...creds, mic: false, speaker: want?.speaker ?? false };
  schedule(creds);
  return room;
}

function schedule(creds: VoiceCreds) {
  clearTimers();
  refreshTimer = window.setTimeout(() => {
    void enqueue(() => rotate(creds));
  }, 12 * 60 * 1000);
  beatTimer = window.setInterval(() => {
    if (!want || want.slug !== creds.slug) return;
    void import("./voice-chat.functions").then(({ beatVoiceSession }) => beatVoiceSession({ data: { ...creds, action: "beat", publish: false } })).catch(() => undefined);
  }, 10_000);
}

async function rotate(creds: VoiceCreds) {
  if (!want || want.slug !== creds.slug || !room) return;
  const mic = want.mic;
  const speaker = want.speaker;
  ignoreDisconnect = true;
  const previous = room;
  room = null;
  connectedSlug = "";
  try { await previous.localParticipant.setMicrophoneEnabled(false); } catch { /* releasing the old token */ }
  detach();
  previous.removeAllListeners();
  await previous.disconnect().catch(() => undefined);
  ignoreDisconnect = false;
  const joined = await ensure(creds);
  if (!joined || !want) {
    want = null;
    emit({ micEnabled: false, speakerEnabled: false, connecting: false, error: "Voice chat expired. Turn the microphone or speaker on again." });
    return;
  }
  if (speaker) {
    want.speaker = true;
    try { await joined.startAudio(); } catch { /* the speaker button can retry playback */ }
    await applySpeaker(true, joined);
    patch({ speakerEnabled: true });
  }
  if (mic) {
    const allowed = await publishFlag(creds, true);
    if (!allowed) {
      if (want) want.mic = false;
      patch({ micEnabled: false, error: "The microphone could not be opened again." });
      return;
    }
    await joined.localParticipant.setMicrophoneEnabled(true);
    if (want) want.mic = true;
    patch({ micEnabled: true });
  } else {
    try { await joined.localParticipant.setMicrophoneEnabled(false); } catch { /* stays off */ }
  }
}

function bind(active: LiveRoom, published: string, subscribed: string, unsubscribed: string, reconnected: string, disconnected: string, audioKind: string) {
  active.on(published, ((publication: RemotePub) => {
    if (!want?.speaker || !voicePublication(publication)) return;
    void publication.setSubscribed(true);
  }) as (...args: never[]) => void);
  active.on(subscribed, ((track: { kind: string; attach: () => HTMLMediaElement; detach: () => HTMLMediaElement[] }) => {
    if (track.kind !== audioKind || !want?.speaker) {
      track.detach();
      return;
    }
    const element = track.attach();
    element.autoplay = true;
    element.setAttribute("playsinline", "true");
    element.dataset.voice = "remote";
    document.body.appendChild(element);
    elements.add(element);
    void element.play().catch(() => {
      patch({ error: "Tap the speaker again so this browser can play voices." });
    });
  }) as (...args: never[]) => void);
  active.on(unsubscribed, ((track: { detach: () => HTMLMediaElement[] }) => {
    for (const element of track.detach()) elements.delete(element);
  }) as (...args: never[]) => void);
  active.on(reconnected, (() => {
    void enqueue(async () => {
      if (!room || !want) return;
      if (!want.mic) {
        try { await room.localParticipant.setMicrophoneEnabled(false); } catch { /* stays off */ }
      }
      await applySpeaker(want.speaker, room);
    });
  }) as (...args: never[]) => void);
  active.on(disconnected, (() => {
    if (ignoreDisconnect || room !== active) return;
    if (!want || retries >= 3) {
      want = null;
      room = null;
      connectedSlug = "";
      detach();
      emit({ micEnabled: false, speakerEnabled: false, connecting: false, error: "Voice chat disconnected." });
      return;
    }
    retries += 1;
    const creds = want;
    window.setTimeout(() => {
      void enqueue(async () => {
        if (!want || want.slug !== creds.slug) return;
        const mic = want.mic;
        const speaker = want.speaker;
        room = null;
        const joined = await ensure(creds);
        if (!joined || !want) return;
        if (!mic) {
          try { await joined.localParticipant.setMicrophoneEnabled(false); } catch { /* stays off */ }
        } else {
          const allowed = await publishFlag(creds, true);
          if (allowed) {
            await joined.localParticipant.setMicrophoneEnabled(true);
            if (want) want.mic = true;
            patch({ micEnabled: true });
          }
        }
        if (speaker && want) {
          want.speaker = true;
          await applySpeaker(true, joined);
          patch({ speakerEnabled: true });
        }
      });
    }, 500 * retries);
  }) as (...args: never[]) => void);
}

export function installVoiceGuards() {
  if (guards || typeof window === "undefined") return;
  guards = true;
  window.addEventListener("pagehide", () => {
    void enqueue(() => disconnect("leave"));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void enqueue(() => disconnect("hide"));
  });
  navigator.mediaDevices?.addEventListener?.("devicechange", () => {
    void enqueue(async () => {
      if (!want?.mic || !room) return;
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch {
        if (want) want = { ...want, mic: false };
        patch({ micEnabled: false, error: "The microphone was disconnected." });
      }
    });
  });
}

export function hangupVoice(event: "leave" | "wedding" | "logout" = "leave") {
  return enqueue(() => disconnect(event));
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

async function captureMic() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    const error = new Error("This browser has no microphone.");
    error.name = "NotFoundError";
    throw error;
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

export function setVoiceMic(on: boolean, creds: VoiceCreds) {
  return enqueue(async () => {
    if (!on) {
      if (want) want = { ...want, mic: false };
      if (room) {
        try { await room.localParticipant.setMicrophoneEnabled(false); } catch { /* already stopped */ }
      }
      await publishFlag(creds, false);
      patch({ micEnabled: false, connecting: false });
      if (want && !want.speaker) await disconnect("leave");
      else if (!want) emit({ micEnabled: false, speakerEnabled: false, connecting: false, error: "" });
      return;
    }
    patch({ connecting: true, error: "" });
    let probe: MediaStream | null = null;
    try {
      probe = await captureMic();
    } catch (error) {
      patch({
        micEnabled: false,
        connecting: false,
        error: denied(error)
          ? "Microphone permission was denied. Chat still works. Allow the microphone in the browser settings to talk."
          : "This browser could not open a microphone.",
      });
      return;
    }
    let active: LiveRoom | null = null;
    try {
      active = await ensure(creds);
    } catch {
      stopStream(probe);
      emit({ micEnabled: false, speakerEnabled: snapshot.speakerEnabled, connecting: false, error: "Voice chat could not be reached. Try again." });
      return;
    }
    stopStream(probe);
    if (!active || !want) return;
    const allowed = await publishFlag(creds, true);
    if (!allowed) {
      if (want) want = { ...want, mic: false };
      patch({ micEnabled: false, connecting: false, error: "The microphone could not be opened for this wedding." });
      if (want && !want.speaker) await disconnect("leave", true);
      return;
    }
    try {
      await active.localParticipant.setMicrophoneEnabled(true);
      if (want) want = { ...want, mic: true };
      patch({ micEnabled: true, connecting: false, error: "" });
    } catch (error) {
      await publishFlag(creds, false);
      if (want) want = { ...want, mic: false };
      try { await active.localParticipant.setMicrophoneEnabled(false); } catch { /* stays off */ }
      patch({
        micEnabled: false,
        connecting: false,
        error: denied(error)
          ? "Microphone permission was denied. Chat still works. Allow the microphone in the browser settings to talk."
          : "The microphone could not be started.",
      });
      if (want && !want.speaker) await disconnect("leave", true);
    }
  });
}

export function setVoiceSpeaker(on: boolean, creds: VoiceCreds) {
  return enqueue(async () => {
    if (!on) {
      if (want) want = { ...want, speaker: false };
      if (room) await applySpeaker(false, room);
      patch({ speakerEnabled: false });
      if (want && !want.mic) await disconnect("leave");
      return;
    }
    patch({ connecting: true, error: "" });
    let active: LiveRoom | null = null;
    try {
      active = await ensure(creds);
    } catch {
      emit({ micEnabled: snapshot.micEnabled, speakerEnabled: false, connecting: false, error: "Voice chat could not be reached. Try again." });
      return;
    }
    if (!active || !want) return;
    try { await active.startAudio(); } catch { /* playback status covers a blocked start */ }
    want = { ...want, speaker: true };
    await applySpeaker(true, active);
    const blocked = active.canPlaybackAudio === false;
    patch({
      speakerEnabled: true,
      connecting: false,
      error: blocked ? "Tap the speaker again so this browser can play voices." : snapshot.error && snapshot.micEnabled ? snapshot.error : "",
    });
  });
}
