type Track = MediaStreamTrack;
type KitParticipant = {
  id: string;
  videoEnabled: boolean;
  audioEnabled: boolean;
  videoTrack: Track;
  audioTrack: Track;
  registerVideoElement: (video: HTMLVideoElement) => void;
  on: (event: "videoUpdate" | "audioUpdate", listener: (payload: { videoEnabled?: boolean; videoTrack?: Track; audioEnabled?: boolean; audioTrack?: Track }) => void) => void;
};
type KitMeeting = {
  join: () => Promise<void>;
  leave: () => Promise<void>;
  participants: {
    count: number;
    joined: Map<string, KitParticipant> & {
      on: (event: "participantJoined" | "participantLeft" | "participantsUpdate", listener: (participant?: KitParticipant) => void) => void;
    };
  };
  self: {
    roomJoined: boolean;
    videoEnabled: boolean;
    audioEnabled: boolean;
    videoTrack: Track;
    audioTrack: Track;
    registerVideoElement: (video: HTMLVideoElement, preview?: boolean) => void;
    deregisterVideoElement: (video?: HTMLVideoElement, preview?: boolean) => void;
    enableVideo: () => Promise<void>;
    disableVideo: () => Promise<void>;
    enableAudio: () => Promise<void>;
    disableAudio: () => Promise<void>;
    getVideoDevices: () => Promise<MediaDeviceInfo[]>;
    setDevice: (device: MediaDeviceInfo) => Promise<void>;
    on: (event: "roomJoined" | "roomLeft" | "videoUpdate" | "audioUpdate", listener: (payload?: { reconnected?: boolean; videoTrack?: Track; audioTrack?: Track }) => void) => void;
  };
};

type Handle = { token: string; role: "host" | "guest"; meeting: KitMeeting };

let current: Handle | null = null;
let opening: Promise<Handle> | null = null;

function prepare(video: HTMLVideoElement) {
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
}

function streamFrom(videoTrack?: Track | null, audioTrack?: Track | null) {
  const tracks = [videoTrack, audioTrack].filter((track): track is Track => Boolean(track && track.readyState !== "ended"));
  return tracks.length ? new MediaStream(tracks) : null;
}

export function realtimeMeetingOpen() {
  return Boolean(current);
}

export async function leaveRealtime() {
  const held = current;
  current = null;
  opening = null;
  if (!held) return;
  try {
    held.meeting.self.deregisterVideoElement();
  } catch {
    /* The element may already be gone. */
  }
  await held.meeting.leave().catch(() => undefined);
}

async function openMeeting(authToken: string, role: "host" | "guest") {
  if (current?.token === authToken && current.role === role) return current;
  if (current) await leaveRealtime();
  if (opening) return opening;
  const produce = role === "host";
  opening = (async () => {
    const RealtimeKitClient = (await import("@cloudflare/realtimekit")).default as {
      init: (options: {
        authToken: string;
        defaults: { audio: boolean; video: boolean; mediaConfiguration?: { video: { width: { ideal: number }; height: { ideal: number }; frameRate: { ideal: number } } } };
      }) => Promise<KitMeeting>;
    };
    const meeting = await RealtimeKitClient.init({
      authToken,
      defaults: {
        audio: produce,
        video: produce,
        ...(produce ? { mediaConfiguration: { video: { width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 24 } } } } : {}),
      },
    });
    await meeting.join();
    const handle = { token: authToken, role, meeting };
    current = handle;
    return handle;
  })();
  try {
    return await opening;
  } finally {
    opening = null;
  }
}

export async function joinHostPreview(input: { authToken: string; video: HTMLVideoElement; onStatus: (status: string) => void; onCount: (count: number) => void }) {
  if (typeof window === "undefined") throw new Error("The camera opens in the browser.");
  prepare(input.video);
  input.video.muted = true;
  const handle = await openMeeting(input.authToken, "host");
  handle.meeting.self.registerVideoElement(input.video, true);
  const publish = () => input.onCount(handle.meeting.participants.count);
  handle.meeting.self.on("roomJoined", (payload) => input.onStatus(payload?.reconnected ? "reconnecting" : "connected"));
  handle.meeting.self.on("roomLeft", () => input.onStatus("ended"));
  handle.meeting.participants.joined.on("participantsUpdate", publish);
  handle.meeting.participants.joined.on("participantJoined", publish);
  handle.meeting.participants.joined.on("participantLeft", publish);
  publish();
  input.onStatus(handle.meeting.self.roomJoined ? "connected" : "connecting");
  return handle;
}

export async function watchRealtime(input: { authToken: string; onStream: (stream: MediaStream | null) => void; onStatus: (status: string) => void; onCount: (count: number) => void }) {
  if (typeof window === "undefined") return;
  const handle = await openMeeting(input.authToken, "guest");
  const publishParticipant = (participant: KitParticipant) => {
    input.onStream(streamFrom(participant.videoEnabled ? participant.videoTrack : null, participant.audioEnabled ? participant.audioTrack : null));
    participant.on("videoUpdate", (payload) => {
      input.onStream(streamFrom(payload.videoEnabled ? payload.videoTrack : participant.videoTrack, participant.audioTrack));
    });
    participant.on("audioUpdate", (payload) => {
      input.onStream(streamFrom(participant.videoTrack, payload.audioEnabled ? payload.audioTrack : participant.audioTrack));
    });
  };
  handle.meeting.participants.joined.forEach((participant) => publishParticipant(participant));
  handle.meeting.participants.joined.on("participantJoined", (participant) => {
    if (participant) publishParticipant(participant);
  });
  handle.meeting.self.on("roomJoined", (payload) => input.onStatus(payload?.reconnected ? "reconnecting" : "connected"));
  handle.meeting.self.on("roomLeft", () => input.onStatus("ended"));
  input.onCount(handle.meeting.participants.count);
  input.onStatus(handle.meeting.self.roomJoined ? "connected" : "connecting");
}

export async function setRealtimeCamera(enabled: boolean) {
  const meeting = current?.role === "host" ? current.meeting : null;
  if (!meeting) return enabled;
  if (enabled) await meeting.self.enableVideo();
  else await meeting.self.disableVideo();
  return meeting.self.videoEnabled;
}

export async function setRealtimeMic(enabled: boolean) {
  const meeting = current?.role === "host" ? current.meeting : null;
  if (!meeting) return enabled;
  if (enabled) await meeting.self.enableAudio();
  else await meeting.self.disableAudio();
  return meeting.self.audioEnabled;
}

export async function flipRealtimeCamera() {
  const meeting = current?.role === "host" ? current.meeting : null;
  if (!meeting) return false;
  const devices = await meeting.self.getVideoDevices();
  const currentTrack = meeting.self.videoTrack;
  const currentId = currentTrack?.getSettings?.().deviceId || "";
  const next = devices.find((device) => device.deviceId && device.deviceId !== currentId) || devices[0];
  if (!next) return false;
  await meeting.self.setDevice(next);
  return true;
}
