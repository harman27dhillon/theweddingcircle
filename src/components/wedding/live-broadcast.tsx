import { useEffect, useRef, useState } from "react";
import { weddingLive } from "@/lib/wedding/live-room.functions";

type Signal = { id: number; from: string; to: string; kind: "offer" | "answer" | "ice"; payload: RTCSessionDescriptionInit | RTCIceCandidateInit };

function limitVideo(pc: RTCPeerConnection) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "video") continue;
    const params = sender.getParameters();
    const encodings = params.encodings?.length ? params.encodings : [{}];
    encodings[0] = { ...encodings[0], maxBitrate: 700_000, maxFramerate: 24 };
    params.encodings = encodings;
    void sender.setParameters(params).catch(() => undefined);
  }
}

const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
const publishGeneration: Map<string, number> = ((globalThis as unknown as { __wcLiveGen?: Map<string, number> }).__wcLiveGen ??= new Map());

type RoomView = {
  live: boolean;
  hostName: string;
  viewerCount: number;
  chats: { id: number; peerId: string; name: string; text: string }[];
  bursts: { id: number; emoji: string }[];
  error?: string;
  ended?: boolean;
  signaling?: boolean;
};

export function livePeerId() {
  if (typeof sessionStorage === "undefined") return `p${Date.now().toString(36)}00`;
  const key = "wc-live-peer";
  const existing = sessionStorage.getItem(key);
  if (existing && /^[a-zA-Z0-9_-]{6,80}$/.test(existing)) return existing;
  const id = `p${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  sessionStorage.setItem(key, id);
  return id;
}

export function LiveBroadcast({
  slug,
  name,
  codes,
  publishing,
  localStream,
  trackVersion = 0,
  onPublishing,
  onWatching,
  onMedia,
  onRoom,
  onError,
  onStream,
  onConnection,
  memberKey = "",
  access = "",
  roster = "",
  sinkOnly = false,
  showLocal = true,
  externalMedia = false,
}: {
  slug: string;
  name: string;
  codes: string[];
  publishing: boolean;
  localStream?: MediaStream | null;
  trackVersion?: number;
  onPublishing: (on: boolean) => void;
  onWatching: (on: boolean) => void;
  onMedia?: (on: boolean) => void;
  onRoom?: (room: RoomView) => void;
  onError?: (message: string) => void;
  onStream?: (stream: MediaStream | null) => void;
  onConnection?: (state: "connected" | "failed") => void;
  memberKey?: string;
  access?: string;
  roster?: string;
  sinkOnly?: boolean;
  showLocal?: boolean;
  externalMedia?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const selfRef = useRef(livePeerId());
  const streamRef = useRef<MediaStream | null>(null);
  const ownedRef = useRef(false);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const afterRef = useRef(0);
  const armingRef = useRef(new Set<string>());
  const memberRef = useRef(memberKey);
  const accessRef = useRef(access);
  const rosterRef = useRef(roster);
  const onStreamRef = useRef(onStream);
  const onConnectionRef = useRef(onConnection);
  memberRef.current = memberKey;
  accessRef.current = access;
  rosterRef.current = roster;
  onStreamRef.current = onStream;
  onConnectionRef.current = onConnection;
  const [show, setShow] = useState(false);
  const code = codes[0] ?? "";

  useEffect(() => {
    let stopped = false;
    const peers = peersRef.current;
    const self = selfRef.current;
    const publishKey = `${slug}:${self}`;
    const generation = publishing ? (publishGeneration.get(publishKey) ?? 0) + 1 : 0;
    if (publishing) publishGeneration.set(publishKey, generation);
    const stillPublishing = () => publishing && publishGeneration.get(publishKey) === generation;

    function closePeers() {
      for (const pc of peers.values()) pc.close();
      peers.clear();
    }

    function stopCamera() {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    async function send(to: string, kind: Signal["kind"], payload: Signal["payload"]) {
      await weddingLive({ data: { action: "signal", slug, peerId: self, name, code, codes, to, kind, payload, after: 0, text: "", memberKey: memberRef.current, access: accessRef.current, roster: rosterRef.current, stream: publishing ? self : "", watch: "" } });
    }

    function bindIce(pc: RTCPeerConnection, to: string) {
      pc.onicecandidate = (event) => {
        if (event.candidate) void send(to, "ice", event.candidate.toJSON());
      };
    }

    async function answerViewer(signal: Signal, stream: MediaStream) {
      let pc = peers.get(signal.from);
      if (!pc || pc.connectionState === "closed" || pc.connectionState === "failed" || pc.signalingState === "closed") {
        pc?.close();
        pc = new RTCPeerConnection({ iceServers });
        peers.set(signal.from, pc);
        stream.getTracks().forEach((track) => pc?.addTrack(track, stream));
        bindIce(pc, signal.from);
        pc.onconnectionstatechange = () => {
          if (pc?.connectionState === "connected") limitVideo(pc);
        };
      }
      await pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      limitVideo(pc);
      await send(signal.from, "answer", answer);
    }

    async function watchHost(hostId: string) {
      if (peers.has(hostId) || !videoRef.current) return;
      const pc = new RTCPeerConnection({ iceServers });
      peers.set(hostId, pc);
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
      bindIce(pc, hostId);
      pc.ontrack = (event) => {
        const remote = event.streams[0] ?? new MediaStream([event.track]);
        onStreamRef.current?.(remote);
        setShow(true);
        onWatching(true);
        onMedia?.(true);
        onConnectionRef.current?.("connected");
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") onConnectionRef.current?.("failed");
        if (pc.connectionState === "connected") onConnectionRef.current?.("connected");
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await send(hostId, "offer", offer);
    }

    const pendingIce = new Map<string, RTCIceCandidateInit[]>();
    async function handle(signal: Signal, stream: MediaStream | null) {
      if (Number(signal.id) > afterRef.current) afterRef.current = Number(signal.id);
      const pc = peers.get(signal.from);
      if (signal.kind === "offer" && stream) {
        await answerViewer(signal, stream);
        const queued = pendingIce.get(signal.from) ?? [];
        pendingIce.delete(signal.from);
        const ready = peers.get(signal.from);
        if (ready) {
          for (const candidate of queued) await ready.addIceCandidate(candidate as RTCIceCandidateInit).catch(() => undefined);
        }
        return;
      }
      if (!pc) return;
      if (signal.kind === "answer") {
        await pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
        return;
      }
      if (signal.kind === "ice") {
        if (!pc.remoteDescription) {
          const queued = pendingIce.get(signal.from) ?? [];
          queued.push(signal.payload as RTCIceCandidateInit);
          pendingIce.set(signal.from, queued);
          return;
        }
        try {
          await pc.addIceCandidate(signal.payload as RTCIceCandidateInit);
        } catch {
          /* A late candidate can arrive before the description. */
        }
      }
    }

    async function run() {
      if (publishing) {
        if (externalMedia) {
          const issued = Date.now();
          const started = await weddingLive({ data: { action: "start", slug, peerId: self, name, code, codes, to: "", kind: "", payload: null, after: issued, text: "", memberKey: memberRef.current, access: accessRef.current, roster: rosterRef.current, stream: self, watch: "" } });
          if (stopped || !stillPublishing()) return;
          if (!started.ok || !started.live) {
            onError?.("error" in started && started.error ? started.error : "The stream could not start.");
            onPublishing(false);
            return;
          }
          onMedia?.(true);
        } else {
        const owned = !localStream;
        ownedRef.current = owned;
        try {
          const stream = localStream ?? (await navigator.mediaDevices.getUserMedia({ video: true, audio: true }));
          if (stopped) {
            if (owned) stream.getTracks().forEach((track) => track.stop());
            return;
          }
          streamRef.current = stream;
          setShow(true);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.muted = true;
          }
          const issued = Date.now();
          const started = await weddingLive({ data: { action: "start", slug, peerId: self, name, code, codes, to: "", kind: "", payload: null, after: issued, text: "", memberKey: memberRef.current, access: accessRef.current, roster: rosterRef.current, stream: self, watch: "" } });
          if (stopped || !stillPublishing()) {
            if (stillPublishing()) {
              void weddingLive({ data: { action: "stop", slug, peerId: self, name, code, codes, to: "", kind: "", payload: null, after: Date.now(), text: "", memberKey: memberRef.current, access: "", roster: "", stream: self, watch: "" } }).catch(() => undefined);
            }
            if (owned) stopCamera();
            return;
          }
          if (!started.ok || !started.live) {
            if (owned) stopCamera();
            onError?.("error" in started && started.error ? started.error : "The stream could not start.");
            onPublishing(false);
            return;
          }
        } catch {
          if (ownedRef.current) stopCamera();
          onError?.("The camera could not start.");
          onPublishing(false);
          return;
        }
        }
      }

      let sawLive = false;
      let toldEnd = false;
      let busySince = 0;
      const tick = async () => {
        if (stopped) return;
        if (busySince && Date.now() - busySince < 5000) return;
        busySince = Date.now();
        try {
          const result = await Promise.race([
            weddingLive({
              data: { action: "poll", slug, peerId: self, name, code, codes, to: "", kind: "", payload: null, after: afterRef.current, text: "", memberKey: memberRef.current, access: "", roster: "", stream: publishing ? self : "", watch: "" },
            }).catch(() => null),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
          ]);
          if (stopped) return;
          if (!result) return;
          else if (!result.ok) {
            onRoom?.({ live: false, hostName: "", viewerCount: 0, chats: [], bursts: [], error: "error" in result ? result.error : "The live could not be opened." });
            onWatching(false);
            onMedia?.(false);
          } else if (!result.live) {
            if (sawLive || publishing) toldEnd = true;
            onRoom?.({ live: false, hostName: "", viewerCount: 0, chats: [], bursts: [], ended: toldEnd });
            if (!publishing) {
              closePeers();
              if (videoRef.current) videoRef.current.srcObject = null;
              onStreamRef.current?.(null);
              onWatching(false);
              onMedia?.(false);
              setShow(false);
            }
            sawLive = false;
          } else {
            sawLive = true;
            toldEnd = false;
            onWatching(true);
            const signals = (Array.isArray(result.signals) ? result.signals : []) as Signal[];
            for (const signal of signals) {
              if (Number(signal.id) > afterRef.current) afterRef.current = Number(signal.id);
            }
            const stream = streamRef.current;
            if (publishing && stream && !externalMedia) {
              void (async () => {
                for (const signal of signals) await handle(signal, stream);
              })().catch(() => undefined);
            } else if (!publishing && !externalMedia && result.hostId && result.hostId !== self && result.signaling !== false) {
              const hostId = result.hostId;
              if (!peers.has(hostId) && !armingRef.current.has(hostId)) armingRef.current.add(hostId);
              void (async () => {
                try {
                  if (!peers.has(hostId)) await watchHost(hostId);
                  for (const signal of signals) await handle(signal, null);
                } finally {
                  armingRef.current.delete(hostId);
                }
              })().catch(() => undefined);
            }
            onRoom?.({
              live: true,
              hostName: result.hostName || "",
              viewerCount: result.viewerCount ?? 0,
              chats: result.chats ?? [],
              bursts: result.bursts ?? [],
              signaling: result.signaling !== false,
            });
          }
        } catch {
          /* A failed poll keeps the last confirmed session. */
        } finally {
          busySince = 0;
        }
      };
      if (stopped) return;
      const interval = window.setInterval(() => void tick(), publishing ? 800 : 1000);
      const onVisible = () => {
        if (document.visibilityState === "visible") void tick();
      };
      document.addEventListener("visibilitychange", onVisible);
      timer.id = interval;
      timer.vis = onVisible;
      void tick();
    }

    const timer: { id: number; vis: (() => void) | null } = { id: 0, vis: null };
    void run();
    return () => {
      stopped = true;
      window.clearInterval(timer.id);
      if (timer.vis) document.removeEventListener("visibilitychange", timer.vis);
      const wasPublishing = publishing;
      closePeers();
      if (ownedRef.current) stopCamera();
      else if (videoRef.current) videoRef.current.srcObject = null;
      onStreamRef.current?.(null);
      onWatching(false);
      onMedia?.(false);
      setShow(false);
      if (!wasPublishing) return;
      const end = () => {
        if (!stillPublishing()) return;
        void weddingLive({
          data: { action: "stop", slug, peerId: self, name, code, codes, to: "", kind: "", payload: null, after: Date.now(), text: "", memberKey: memberRef.current, access: "", roster: "", stream: self, watch: "" },
        }).catch(() => undefined);
      };
      window.setTimeout(end, 400);
    };
  }, [publishing, slug, localStream, externalMedia]);

  useEffect(() => {
    const stream = streamRef.current;
    if (!publishing || !stream) return;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => undefined);
    }
    const videoTrack = stream.getVideoTracks()[0] ?? null;
    const audioTrack = stream.getAudioTracks()[0] ?? null;
    for (const pc of peersRef.current.values()) {
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind === "video" && videoTrack && sender.track !== videoTrack) void sender.replaceTrack(videoTrack).then(() => limitVideo(pc));
        if (sender.track?.kind === "audio" && audioTrack && sender.track !== audioTrack) void sender.replaceTrack(audioTrack);
      }
      if (videoTrack) limitVideo(pc);
    }
  }, [trackVersion, publishing]);

  return (
    <video
      ref={videoRef}
      className={sinkOnly || !showLocal ? "pointer-events-none fixed top-0 left-0 z-0 h-px w-px opacity-0" : show || publishing ? "absolute inset-0 z-[1] h-full w-full bg-ink object-contain" : "hidden"}
      autoPlay
      playsInline
      muted={publishing || sinkOnly}
    />
  );
}
