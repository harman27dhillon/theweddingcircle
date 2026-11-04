import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { CircleStop, Maximize2, Mic, MicOff, Minimize2, Radio, SwitchCamera, Video, VideoOff, X } from "lucide-react";
import { toast } from "sonner";
import { LiveBroadcast, livePeerId } from "@/components/wedding/live-broadcast";
import { LiveWatch, type CameraView } from "@/components/wedding/live-watch";
import { Button } from "@/components/wedding/ui";
import { useWedding } from "@/components/wedding/context";
import { canView } from "@/lib/wedding/access";
import { type CameraFacing, cameraReleaseDelay, openVideoTrack, otherFacing } from "@/lib/wedding/capture";
import { canPost, codesOf, youtubeId } from "@/lib/wedding/format";
import { playbackBadge, youtubePlayerMessage } from "@/lib/wedding/live-layout";
import { memberKeyFor } from "@/lib/wedding/member-key";
import { weddingLive } from "@/lib/wedding/live-room.functions";
import { useWeddingStore } from "@/lib/wedding/store";

type Phase = "idle" | "preview" | "live";
type Chat = { id: number; peerId: string; name: string; text: string; at?: number };

const LIVE_NOTE_MS = 60_000;

export function useLiveOverlay<T extends { id: number | string; at?: number }>(chats: T[]) {
  const seen = useRef(new Map<string, number>());
  const expired = useRef(new Set<string>());
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return useMemo(() => {
    if (!now) return [] as T[];
    const next: T[] = [];
    for (const chat of chats) {
      const id = String(chat.id);
      if (expired.current.has(id)) continue;
      const serverAt = typeof chat.at === "number" && chat.at > 0 ? chat.at : 0;
      if (serverAt && now - serverAt >= LIVE_NOTE_MS) {
        expired.current.add(id);
        continue;
      }
      let born = seen.current.get(id);
      if (!born) {
        born = now;
        seen.current.set(id, born);
      }
      const start = serverAt ? Math.min(born, serverAt) : born;
      if (now - start >= LIVE_NOTE_MS) {
        expired.current.add(id);
        continue;
      }
      next.push(chat);
    }
    return next.sort((a, b) => Number(a.id) - Number(b.id));
  }, [chats, now]);
}

export function LiveCommentTape({ chats }: { chats: { id: number | string; name: string; text: string; at?: number }[] }) {
  const items = useLiveOverlay(chats);
  if (items.length === 0) return null;
  return (
    <ul className="pointer-events-none flex max-h-40 flex-col justify-end gap-1 overflow-hidden" aria-live="polite">
      {items.map((item) => (
        <li key={String(item.id)} className="live-comment max-w-[88%] rounded-2xl bg-ink/55 px-2.5 py-1 text-sm text-on-photo">
          <span className="font-medium">{item.name}</span>
          <span> {item.text}</span>
        </li>
      ))}
    </ul>
  );
}
type PlayerMode = "closed" | "expanded" | "mini";

export function YoutubeDock({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const claim = useLiveSession().claimYoutube;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    return claim(node);
  }, [claim]);
  return <div ref={ref} className={className} />;
}

type Selection = { kind: "camera" | "youtube"; id: string } | null;

type LiveSessionValue = {
  phase: Phase;
  minimized: boolean;
  watching: boolean;
  ended: boolean;
  liveError: string;
  signaling: boolean;
  mediaReady: boolean;
  mediaFailed: boolean;
  remoteStream: MediaStream | null;
  setMediaReady: (on: boolean) => void;
  retryWatch: () => void;
  asking: boolean;
  mediaError: string;
  cameraOn: boolean;
  micOn: boolean;
  hostName: string;
  viewerCount: number | null;
  chats: Chat[];
  functionId: string;
  setFunctionId: (id: string) => void;
  startPreview: () => Promise<void>;
  goBroadcast: () => void;
  askEnd: () => void;
  confirmingEnd: boolean;
  cancelEnd: () => void;
  endBroadcast: () => void | Promise<void>;
  stopping: boolean;
  cancelPreview: () => void;
  toggleCamera: () => void;
  toggleMic: () => void;
  flipCamera: () => Promise<void>;
  minimize: () => void;
  restore: () => void;
  sendRoom: (action: "comment" | "react" | "drop", text: string, to?: string) => Promise<void>;
  applyRoom: (room: { live: boolean; hostName: string; viewerCount: number; chats: Chat[]; bursts: { id: number; emoji: string }[]; error?: string; ended?: boolean; signaling?: boolean }) => void;
  selfId: string;
  cameras: CameraView[];
  player: PlayerMode;
  selected: Selection;
  focusChats: Chat[];
  focusViewers: number;
  directoryError: string;
  youtubeState: string;
  openCamera: (id: string) => void;
  openYoutube: () => void;
  minimizeWatch: () => void;
  backToGrid: () => void;
  closeWatch: () => void;
  retryCamera: (id: string) => void;
  claimYoutube: (node: HTMLElement) => () => void;
};

const LiveSessionContext = createContext<LiveSessionValue | null>(null);

// The session hook has to live beside the provider that owns the streams.
// eslint-disable-next-line react-refresh/only-export-components
export function useLiveSession() {
  const value = useContext(LiveSessionContext);
  if (!value) throw new Error("Live session is only available inside a wedding.");
  return value;
}

function permissionMessage(videoError: unknown, audioError: unknown) {
  const nameOf = (error: unknown) => (error instanceof DOMException ? error.name : "");
  const video = nameOf(videoError);
  const audio = nameOf(audioError);
  if (video === "NotAllowedError" && audio === "NotAllowedError") return "Camera and microphone were blocked. Allow both in the browser site settings, then try again.";
  if (video === "NotAllowedError") return "The camera was blocked. Allow the camera in the browser site settings, then try again.";
  if (audio === "NotAllowedError") return "The microphone was blocked. Allow the microphone in the browser site settings, then try again.";
  if (video === "NotFoundError" || audio === "NotFoundError") return "This device has no camera or microphone that the browser can use.";
  if (video === "NotReadableError" || audio === "NotReadableError") return "The camera or microphone is already in use by another app.";
  return "The camera and microphone could not start.";
}

async function openDevices(facing: CameraFacing) {
  const stream = new MediaStream();
  let videoError: unknown;
  let audioError: unknown;
  let video: MediaStreamTrack | null = null;
  try {
    video = await openVideoTrack(facing);
    stream.addTrack(video);
  } catch (error) {
    videoError = error;
  }
  try {
    const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = audio.getAudioTracks()[0] ?? null;
    audio.getTracks().forEach((item) => {
      if (item !== track) item.stop();
    });
    if (track) stream.addTrack(track);
  } catch (error) {
    audioError = error;
  }
  if (videoError || audioError || !video || stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    video?.stop();
    throw new Error(permissionMessage(videoError, audioError));
  }
  return stream;
}

function lockPortrait() {
  const orientation = screen.orientation as ScreenOrientation & { lock?: (mode: string) => Promise<void> };
  void orientation?.lock?.("portrait").catch(() => undefined);
}

function unlockOrientation() {
  void screen.orientation?.unlock?.();
}

function RoundControl({ label, onClick, children, primary = false, ending = false, disabled = false }: { label: string; onClick: () => void; children: ReactNode; primary?: boolean; ending?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={primary
        ? ending
          ? "live-round live-go-end inline-flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-[#6e2430] bg-[#e4c27a] text-[#4a1520] shadow-[0_0_0_4px_rgba(228,194,122,0.45),0_10px_22px_rgba(0,0,0,0.4)] disabled:opacity-70"
          : "live-round live-go-main inline-flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-[#e4c27a] bg-[#6e2430] text-[#fff8f0] shadow-[0_0_0_4px_rgba(110,36,48,0.45),0_10px_22px_rgba(0,0,0,0.4)]"
        : "live-round inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-white/75 bg-black/35 text-on-photo shadow-[0_2px_8px_rgba(0,0,0,0.35)]"}
    >
      {children}
    </button>
  );
}

export function LiveSessionProvider({ children }: { children: ReactNode }) {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const markLive = useWeddingStore((s) => s.goLive);
  const stopLive = useWeddingStore((s) => s.stopLive);
  const codes = codesOf(wedding).map((item) => item.code);
  const [phase, setPhase] = useState<Phase>("idle");
  const [kitMode, setKitMode] = useState<"in-app" | "realtimekit">("in-app");
  const [kitStatus, setKitStatus] = useState("");
  const [kitStream, setKitStream] = useState<MediaStream | null>(null);
  const kitTokenRef = useRef("");
  const kitModeRef = useRef<"in-app" | "realtimekit">("in-app");
  const [minimized, setMinimized] = useState(false);
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (phase !== "idle" || watching) document.documentElement.dataset.wcLive = "1";
    else delete document.documentElement.dataset.wcLive;
    return () => {
      delete document.documentElement.dataset.wcLive;
    };
  }, [phase, watching]);
  const [ended, setEnded] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [signaling, setSignaling] = useState(true);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [asking, setAsking] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [facing, setFacing] = useState<CameraFacing>("environment");
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [trackVersion, setTrackVersion] = useState(0);
  const [cameras, setCameras] = useState<CameraView[]>([]);
  const [player, setPlayer] = useState<PlayerMode>("closed");
  const [selected, setSelected] = useState<Selection>(null);
  const [focusChats, setFocusChats] = useState<Chat[]>([]);
  const [focusViewers, setFocusViewers] = useState(0);
  const [directoryError, setDirectoryError] = useState("");
  const [youtubeState, setYoutubeState] = useState("idle");
  const [retryKey, setRetryKey] = useState(0);
  const [needsSound, setNeedsSound] = useState(false);
  const [floatPos, setFloatPos] = useState({ x: 12, y: 96 });
  const [hostName, setHostName] = useState("");
  const [viewerCount, setViewerCount] = useState<number | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [functionId, setFunctionId] = useState(wedding.functions.find((item) => item.live)?.id ?? wedding.functions[0]?.id ?? "");
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [startedNote, setStartedNote] = useState(false);
  const armNote = useRef(false);
  const [note, setNote] = useState("");
  const [pos, setPos] = useState({ x: 16, y: 96 });
  useEffect(() => {
    if (phase === "idle") {
      armNote.current = false;
      setStartedNote(false);
      return;
    }
    if (phase === "live" && watching && armNote.current) {
      armNote.current = false;
      setStartedNote(true);
      const timer = window.setTimeout(() => setStartedNote(false), 2000);
      return () => window.clearTimeout(timer);
    }
  }, [phase, watching]);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const facingRef = useRef<CameraFacing>("environment");
  const flipLock = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const watchVideoRef = useRef<HTMLVideoElement>(null);
  const youtubeFrame = useRef<HTMLIFrameElement | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const floatDrag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const startingRef = useRef(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const onLive = path.endsWith("/live");
  const liveOpen = canView(wedding, viewer, wedding.liveAccess);
  const selfId = livePeerId();
  const youtube = youtubeId(wedding.youtubeUrl ?? "");
  facingRef.current = facing;

  function stopCapture() {
    cameraTrackRef.current?.stop();
    cameraTrackRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function publishCamera(track: MediaStreamTrack) {
    const published = streamRef.current;
    if (!published) return;
    for (const item of [...published.getVideoTracks()]) {
      published.removeTrack(item);
      if (item !== track) item.stop();
    }
    if (!published.getVideoTracks().includes(track)) published.addTrack(track);
    cameraTrackRef.current = track;
    const preview = previewRef.current;
    if (preview) {
      preview.muted = true;
      preview.defaultMuted = true;
      preview.playsInline = true;
      preview.setAttribute("playsinline", "true");
      preview.setAttribute("webkit-playsinline", "true");
      preview.srcObject = null;
      preview.srcObject = published;
      void preview.play().catch(() => undefined);
    }
    setTrackVersion((value) => value + 1);
  }

  useEffect(() => {
    return () => {
      void import("@/lib/wedding/realtime-client").then(({ leaveRealtime }) => leaveRealtime()).catch(() => undefined);
      stopCapture();
      unlockOrientation();
    };
  }, []);

  useEffect(() => {
    if (phase === "idle" || kitModeRef.current === "realtimekit") return;
    const attach = (fresh: boolean) => {
      const video = previewRef.current;
      const stream = streamRef.current;
      if (!video || !stream) return;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      if (fresh) video.srcObject = null;
      if (fresh || video.srcObject !== stream) video.srcObject = stream;
      void video.play().catch(() => undefined);
    };
    attach(false);
    const onOrient = () => attach(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") onOrient();
    };
    screen.orientation?.addEventListener("change", onOrient);
    window.addEventListener("orientationchange", onOrient);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      screen.orientation?.removeEventListener("change", onOrient);
      window.removeEventListener("orientationchange", onOrient);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase, trackVersion]);

  useEffect(() => {
    if (phase === "idle" || kitModeRef.current !== "realtimekit" || !kitTokenRef.current) return;
    let gone = false;
    const join = () => {
      const node = previewRef.current;
      const token = kitTokenRef.current;
      if (!node || !token) return;
      void import("@/lib/wedding/realtime-client").then(async ({ joinHostPreview }) => {
        if (gone) return;
        await joinHostPreview({
          authToken: token,
          video: node,
          onStatus: (status) => {
            if (!gone) setKitStatus(status);
          },
          onCount: (count) => {
            if (!gone) setViewerCount(count);
          },
        });
      }).catch((error) => {
        if (!gone) setMediaError(error instanceof Error ? error.message : "The camera could not join.");
      });
    };
    join();
    const onVisible = () => {
      if (document.visibilityState === "visible") join();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("orientationchange", onVisible);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("orientationchange", onVisible);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "idle") return;
    if (viewer.role === "host" || viewer.role === "cohost") return;
    let gone = false;
    const joined = { current: false };
    void import("@/lib/wedding/realtime.functions").then(async ({ realtimeSession }) => {
      const status = await realtimeSession({
        data: { action: "status", slug: wedding.slug, ceremonyId: functionId, memberKey: memberKeyFor(wedding.slug), name: viewer.name, peerId: livePeerId() },
      }).catch(() => null);
      if (gone || !status || !status.ok || status.mode !== "realtimekit" || !("live" in status) || !status.live) return;
      const watched = await realtimeSession({
        data: { action: "watch", slug: wedding.slug, ceremonyId: functionId, memberKey: memberKeyFor(wedding.slug), name: viewer.name, peerId: livePeerId() },
      }).catch(() => null);
      if (gone || !watched || !watched.ok || !("authToken" in watched) || !watched.authToken) return;
      kitModeRef.current = "realtimekit";
      setKitMode("realtimekit");
      joined.current = true;
      const { watchRealtime } = await import("@/lib/wedding/realtime-client");
      if (gone) return;
      await watchRealtime({
        authToken: watched.authToken,
        onStream: (stream) => {
          if (!gone) setKitStream(stream);
        },
        onStatus: (status) => {
          if (!gone) setKitStatus(status);
        },
        onCount: (count) => {
          if (!gone) setViewerCount(count);
        },
      });
    }).catch(() => undefined);
    return () => {
      gone = true;
      if (joined.current) {
        void import("@/lib/wedding/realtime-client").then(({ leaveRealtime }) => leaveRealtime()).catch(() => undefined);
      }
    };
  }, [phase, wedding.slug, functionId, viewer.role, viewer.name]);

  useEffect(() => {
    if (phase === "idle" || minimized) return;
    const node = stageRef.current;
    const view = window.visualViewport;
    if (!node || !view) return;
    const apply = () => {
      node.style.top = `${view.offsetTop}px`;
      node.style.height = `${view.height}px`;
    };
    apply();
    view.addEventListener("resize", apply);
    view.addEventListener("scroll", apply);
    return () => {
      view.removeEventListener("resize", apply);
      view.removeEventListener("scroll", apply);
      node.style.top = "";
      node.style.height = "";
    };
  }, [phase, minimized]);

  function applyRoom(room: { live: boolean; hostName: string; viewerCount: number; chats: Chat[]; bursts: { id: number; emoji: string }[]; error?: string; ended?: boolean; signaling?: boolean }) {
    setHostName(room.live ? room.hostName : "");
    setViewerCount(room.live ? room.viewerCount : null);
    setChats(room.live ? room.chats : []);
    setWatching(room.live);
    setEnded(Boolean(room.ended) && !room.live);
    setLiveError(room.error ?? "");
    setSignaling(room.signaling !== false);
    if (!room.live) {
      setMediaReady(false);
      setMediaFailed(false);
      setRemoteStream(null);
    }
  }

  function releasePreview() {
    stopCapture();
    if (previewRef.current) previewRef.current.srcObject = null;
    setCameraOn(true);
    setMicOn(true);
    setPhase("idle");
    setMinimized(false);
    setConfirmingEnd(false);
    unlockOrientation();
  }

  async function startPreview() {
    if (phase !== "idle" || startingRef.current) return;
    if (player !== "closed" && selected?.kind === "youtube") {
      toast("Close YouTube before starting the wedding camera.");
      return;
    }
    if (cameras.some((item) => item.hostId !== selfId)) {
      toast("This wedding already has a live stream. End it before starting another.");
      return;
    }
    setAsking(true);
    setMediaError("");
    lockPortrait();
    try {
      const { realtimeSession } = await import("@/lib/wedding/realtime.functions");
      const prepared = await realtimeSession({
        data: {
          action: "start",
          slug: wedding.slug,
          ceremonyId: functionId,
          memberKey: memberKeyFor(wedding.slug),
          name: viewer.name,
          peerId: livePeerId(),
        },
      }).catch(() => null);
      if (prepared && prepared.ok && prepared.mode === "realtimekit") {
        const token = "authToken" in prepared ? prepared.authToken : "";
        if (!token) {
          setMediaError("The meeting did not return a camera token. No camera was opened.");
          setPhase("idle");
          unlockOrientation();
          return;
        }
        kitTokenRef.current = token;
        kitModeRef.current = "realtimekit";
        setKitMode("realtimekit");
        setKitStatus("connecting");
        setEnded(false);
        setLiveError("");
        setMinimized(false);
        setPhase("live");
        return;
      }
      if (!prepared || !prepared.ok) {
        setMediaError(prepared && "error" in prepared && prepared.error ? prepared.error : "The live service did not answer. No camera was opened.");
        setPhase("idle");
        unlockOrientation();
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setMediaError("This browser cannot use the camera.");
        setPhase("idle");
        unlockOrientation();
        return;
      }
      const stream = await openDevices("environment");
      streamRef.current = stream;
      facingRef.current = "environment";
      setFacing("environment");
      const video = stream.getVideoTracks()[0];
      if (video) publishCamera(video);
      setMinimized(false);
      setPhase("preview");
    } catch (error) {
      stopCapture();
      setMediaError(error instanceof Error ? error.message : "The camera could not start.");
      setPhase("idle");
      unlockOrientation();
    } finally {
      setAsking(false);
    }
  }

  function goBroadcast() {
    const chosen = wedding.functions.find((item) => item.id === functionId) ?? wedding.functions[0];
    if (!chosen) {
      toast("Add a function before going live.");
      return;
    }
    if (phase === "live" || startingRef.current) return;
    if (cameras.some((item) => item.hostId !== selfId)) {
      toast("This wedding already has a live stream. End it before starting another.");
      return;
    }
    if (wedding.slug === "lila-nico") {
      toast("The sample circle stays on this phone, so other guests cannot join its camera.");
      return;
    }
    startingRef.current = true;
    armNote.current = true;
    const begin = () => {
      markLive(wedding.id, chosen.id);
      setEnded(false);
      setLiveError("");
      setMinimized(false);
      setPhase("live");
      startingRef.current = false;
    };
    if (viewer.role !== "host") {
      begin();
      return;
    }
    void import("@/lib/wedding/role-client").then(async ({ registerHostAuthority }) => {
      const registered = await registerHostAuthority(wedding);
      if (!registered.ok) {
        startingRef.current = false;
        toast(registered.error || "Only a host can start this camera.");
        return;
      }
      begin();
    });
  }

  async function endBroadcast() {
    if (stopping) return;
    setStopping(true);
    if (kitModeRef.current === "realtimekit") {
      const { leaveRealtime } = await import("@/lib/wedding/realtime-client");
      await leaveRealtime().catch(() => undefined);
      const { realtimeSession } = await import("@/lib/wedding/realtime.functions");
      await realtimeSession({
        data: { action: "stop", slug: wedding.slug, ceremonyId: functionId, memberKey: memberKeyFor(wedding.slug), name: viewer.name, peerId: livePeerId() },
      }).catch(() => null);
      kitTokenRef.current = "";
      kitModeRef.current = "in-app";
      setKitMode("in-app");
      setKitStatus("");
      setKitStream(null);
    }
    const peerId = livePeerId();
    const result = await weddingLive({
      data: { action: "stop", slug: wedding.slug, peerId, name: viewer.name, code: codes[0] ?? "", codes, to: "", kind: "", payload: null, after: Date.now(), text: "", memberKey: memberKeyFor(wedding.slug), access: "", roster: "", stream: peerId, watch: "" },
    }).catch(() => null);
    setStopping(false);
    if (!result || !result.ok || result.live) {
      toast("error" in (result ?? {}) && (result as { error?: string }).error ? (result as { error: string }).error : "The live stream could not be stopped. It is still on.");
      return;
    }
    releasePreview();
    stopLive(wedding.id);
    setWatching(false);
    setHostName("");
    setViewerCount(null);
    setChats([]);
    setEnded(false);
    setLiveError("");
    setSignaling(true);
    setMediaReady(false);
    setMediaFailed(false);
    setRemoteStream(null);
  }

  function toggleCamera() {
    if (kitModeRef.current === "realtimekit") {
      void import("@/lib/wedding/realtime-client").then(async ({ setRealtimeCamera }) => {
        setCameraOn(await setRealtimeCamera(!cameraOn));
      }).catch(() => undefined);
      return;
    }
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOn(track.enabled);
  }

  function toggleMic() {
    if (kitModeRef.current === "realtimekit") {
      void import("@/lib/wedding/realtime-client").then(async ({ setRealtimeMic }) => {
        setMicOn(await setRealtimeMic(!micOn));
      }).catch(() => undefined);
      return;
    }
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }

  async function flipCamera() {
    if (kitModeRef.current === "realtimekit") {
      if (flipLock.current) return;
      flipLock.current = true;
      try {
        const { flipRealtimeCamera } = await import("@/lib/wedding/realtime-client");
        const flipped = await flipRealtimeCamera();
        if (!flipped) toast("This phone has one camera in the live session.");
      } finally {
        flipLock.current = false;
      }
      return;
    }
    const published = streamRef.current;
    if (!published || flipLock.current) return;
    flipLock.current = true;
    const next = otherFacing(facingRef.current);
    const previousFacing = facingRef.current;
    const previous = cameraTrackRef.current;
    const previousId = previous?.getSettings().deviceId ?? "";
    const wasOn = cameraOn;
    try {
      previous?.stop();
      cameraTrackRef.current = null;
      for (const track of [...published.getVideoTracks()]) {
        published.removeTrack(track);
        track.stop();
      }
      await cameraReleaseDelay();
      try {
        const track = await openVideoTrack(next, previousId);
        track.enabled = wasOn;
        facingRef.current = next;
        setFacing(next);
        publishCamera(track);
      } catch (error) {
        await cameraReleaseDelay();
        const restored = await openVideoTrack(previousFacing).catch(() => null);
        if (restored) {
          restored.enabled = wasOn;
          facingRef.current = previousFacing;
          setFacing(previousFacing);
          publishCamera(restored);
          const name = error instanceof DOMException ? error.name : "";
          toast(name === "NotAllowedError" ? "The camera was blocked. Allow the camera in the browser site settings, then try again." : "This device could not switch cameras. The current camera is still on.");
        } else {
          toast("This device could not switch cameras.");
        }
      }
    } finally {
      flipLock.current = false;
    }
  }

  function minimize() {
    const nav = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-nav")) || 0;
    setPos({ x: Math.max(12, window.innerWidth - 168), y: Math.max(12, window.innerHeight - nav - 250) });
    setMinimized(true);
    setConfirmingEnd(false);
  }

  async function sendRoom(action: "comment" | "react" | "drop", text: string, to = "") {
    const others = cameras.filter((item) => item.hostId !== livePeerId());
    const stream = phase === "live" ? livePeerId() : selected?.kind === "camera" ? selected.id : others.length === 1 ? others[0]?.hostId ?? "" : "";
    const result = await weddingLive({
      data: { action, slug: wedding.slug, peerId: livePeerId(), name: viewer.name, code: codes[0] ?? "", codes, to, kind: "", payload: null, after: 0, text, memberKey: memberKeyFor(wedding.slug), access: "", roster: "", stream, watch: "" },
    }).catch(() => null);
    if (result && "error" in result && result.error) toast(result.error);
    if (result && result.ok && Array.isArray(result.chats)) {
      setChats(result.chats);
      setFocusChats(result.chats);
    }
  }

  const blocksAnotherStream = useCallback((kind: "camera" | "youtube", id: string) => {
    const broadcasting = phase !== "idle";
    const cameraLive = cameras.some((item) => item.hostId !== selfId);
    if (kind === "youtube" && (broadcasting || cameraLive || (player !== "closed" && selected?.kind === "camera"))) {
      toast("A Wedding Circle camera is already live. YouTube stays attached, and it does not play beside that camera.");
      return true;
    }
    if (kind === "camera" && cameraLive && !cameras.some((item) => item.hostId === id)) {
      toast("This wedding already has a live stream. End it before starting another.");
      return true;
    }
    return false;
  }, [cameras, phase, player, selected, selfId]);

  const openCamera = useCallback((id: string) => {
    if (blocksAnotherStream("camera", id)) return;
    setSelected({ kind: "camera", id });
    setPlayer("expanded");
    setNeedsSound(false);
    setRetryKey((value) => value + 1);
  }, [blocksAnotherStream]);

  const openYoutube = useCallback(() => {
    if (!youtube) return;
    if (blocksAnotherStream("youtube", youtube)) return;
    setSelected({ kind: "youtube", id: youtube });
    setPlayer("expanded");
    setYoutubeState("loading");
  }, [blocksAnotherStream, youtube]);

  const minimizeWatch = useCallback(() => {
    const nav = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-nav")) || 0;
    const besideHost = phase !== "idle" && minimized;
    setFloatPos({
      x: besideHost ? 12 : Math.max(12, window.innerWidth - 176),
      y: Math.max(12, window.innerHeight - nav - 250),
    });
    setPlayer("mini");
  }, [minimized, phase]);

  const backToGrid = useCallback(() => {
    setPlayer("closed");
    setSelected(null);
    if (!onLive) void navigate({ to: "/w/$slug/live", params: { slug: wedding.slug } });
  }, [navigate, onLive, wedding.slug]);

  const closeWatch = useCallback(() => {
    setPlayer("closed");
    setSelected(null);
    const frame = youtubeFrame.current;
    frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: [], id: "wc-yt", channel: "widget" }), "*");
  }, []);

  const claimYoutube = useCallback((node: HTMLElement) => {
    let frame = youtubeFrame.current;
    if (!frame) {
      frame = document.createElement("iframe");
      frame.id = "wc-yt";
      frame.title = "YouTube";
      frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      frame.allowFullscreen = true;
      frame.className = "h-full w-full bg-ink";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.addEventListener("load", () => {
        frame?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: "wc-yt", channel: "widget" }), "*");
      });
      youtubeFrame.current = frame;
    }
    const src = youtube ? `https://www.youtube-nocookie.com/embed/${youtube}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1&autoplay=1&mute=1` : "";
    if (src && frame.dataset.src !== src) {
      frame.dataset.src = src;
      frame.src = src;
      setYoutubeState("loading");
    }
    node.appendChild(frame);
    try {
      frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "mute", args: [], id: "wc-yt", channel: "widget" }), "*");
      frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [], id: "wc-yt", channel: "widget" }), "*");
    } catch {
      /* The frame may not be ready until its load event. */
    }
    return () => {
      try {
        frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: [], id: "wc-yt", channel: "widget" }), "*");
      } catch {
        /* Already detached. */
      }
      if (frame && node.contains(frame)) node.removeChild(frame);
    };
  }, [youtube]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let data: { event?: string; info?: number | { playerState?: number } };
      try {
        data = JSON.parse(event.data) as typeof data;
      } catch {
        return;
      }
      if (!data || typeof data.event !== "string") return;
      if (data.event === "onStateChange" || data.event === "infoDelivery") {
        const state = typeof data.info === "number" ? data.info : data.info?.playerState;
        if (state === 1) setYoutubeState("playing");
        else if (state === 2) setYoutubeState("paused");
        else if (state === 3) setYoutubeState("buffering");
        else if (state === 0) setYoutubeState("ended");
      } else if (data.event === "onError" && typeof data.info === "number") {
        setYoutubeState(youtubePlayerMessage(data.info));
      } else if (data.event === "onReady") {
        setYoutubeState((current) => (current === "loading" ? "paused" : current));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const selectedCamera = selected?.kind === "camera" ? cameras.find((item) => item.hostId === selected.id) ?? null : null;
  const focusId = selected?.kind === "camera" ? selected.id : "";
  const broadcasterCovering = phase !== "idle" && !minimized;
  const youtubeOpen = player !== "closed" && selected?.kind === "youtube";
  const watchMode: "all" | "one" | "none" = !liveOpen || broadcasterCovering || youtubeOpen ? "none" : player !== "closed" && focusId ? "one" : onLive ? "one" : "none";

  useEffect(() => {
    if (!onLive && player === "expanded") minimizeWatch();
  }, [minimizeWatch, onLive, player]);

  useEffect(() => {
    const expanded = (player === "expanded" && Boolean(selected)) || (phase !== "idle" && !minimized);
    document.body.classList.toggle("live-expanded", expanded);
    return () => document.body.classList.remove("live-expanded");
  }, [minimized, phase, player, selected]);

  useEffect(() => {
    if (player === "closed" || selected?.kind !== "camera") return;
    if (!cameras.some((item) => item.hostId === selected.id)) closeWatch();
  }, [cameras, closeWatch, player, selected]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (phase !== "idle" && !minimized) minimize();
      else if (player === "expanded") minimizeWatch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [minimizeWatch, minimized, phase, player]);

  useEffect(() => {
    const video = watchVideoRef.current;
    const stream = selected?.kind === "camera" ? selectedCamera?.stream ?? null : null;
    if (!video || player === "closed" || !stream) {
      if (video) video.srcObject = null;
      return;
    }
    if (video.srcObject !== stream) video.srcObject = stream;
    video.muted = player === "mini";
    void video.play().then(() => {
      if (player === "mini") return;
      video.muted = false;
      return video.play();
    }).catch(() => {
      setNeedsSound(true);
      video.muted = true;
      void video.play().catch(() => undefined);
    });
  }, [player, selected, selectedCamera]);

  const value: LiveSessionValue = {
    phase,
    minimized,
    watching,
    ended,
    liveError,
    signaling,
    mediaReady,
    mediaFailed,
    remoteStream,
    setMediaReady,
    retryWatch: () => {
      setMediaFailed(false);
      setRetryKey((value) => value + 1);
    },
    asking,
    mediaError,
    cameraOn,
    micOn,
    hostName,
    viewerCount,
    chats,
    functionId,
    setFunctionId,
    startPreview,
    goBroadcast,
    askEnd: () => setConfirmingEnd(true),
    confirmingEnd,
    cancelEnd: () => setConfirmingEnd(false),
    endBroadcast,
    stopping,
    cancelPreview: releasePreview,
    toggleCamera,
    toggleMic,
    flipCamera,
    minimize,
    restore: () => setMinimized(false),
    sendRoom,
    applyRoom,
    selfId,
    cameras,
    player,
    selected,
    focusChats,
    focusViewers,
    directoryError,
    youtubeState,
    openCamera,
    openYoutube,
    minimizeWatch,
    backToGrid,
    closeWatch,
    retryCamera: () => setRetryKey((value) => value + 1),
    claimYoutube,
  };

  const chosen = wedding.functions.find((item) => item.id === functionId);
  const mayTalk = canPost(wedding, viewer);

  return (
    <LiveSessionContext.Provider value={value}>
      {startedNote ? <p className="live-started" role="status">Live started</p> : null}
      <LiveWatch
        slug={wedding.slug}
        name={viewer.name}
        codes={codes}
        memberKey={memberKeyFor(wedding.slug)}
        mode={watchMode}
        focusId={focusId}
        retryKey={retryKey}
        onCameras={setCameras}
        onDirectoryError={setDirectoryError}
        skipPeer={kitMode === "realtimekit"}
        kitStream={kitStream}
        onFocus={(room) => {
          setFocusChats(room.chats);
          setFocusViewers(room.viewerCount);
        }}
      />
      {children}
      {player !== "closed" && selected && liveOpen && !(phase !== "idle" && !minimized) ? (
        <div
          data-noswipe=""
          role="dialog"
          aria-label={player === "mini" ? "Minimized live video" : "Live video"}
          className={player === "mini" ? "live-float fixed z-[38] overflow-hidden rounded-2xl border border-white/40 bg-ink shadow-lg" : "fixed inset-0 z-[70] flex flex-col bg-ink"}
          style={player === "mini" ? { left: floatPos.x, top: floatPos.y, width: 148, height: 222, touchAction: "none" } : { paddingTop: "env(safe-area-inset-top)" }}
          onPointerDown={(event) => {
            if (player !== "mini") return;
            if ((event.target as HTMLElement).closest("button")) return;
            floatDrag.current = { x: event.clientX, y: event.clientY, left: floatPos.x, top: floatPos.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = floatDrag.current;
            if (!start) return;
            const nav = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-nav")) || 0;
            setFloatPos({
              x: Math.min(window.innerWidth - 156, Math.max(8, start.left + event.clientX - start.x)),
              y: Math.min(window.innerHeight - nav - 234, Math.max(8, start.top + event.clientY - start.y)),
            });
          }}
          onPointerUp={() => {
            floatDrag.current = null;
          }}
        >
          <div className={player === "mini" ? "relative h-full w-full" : "relative min-h-0 w-full flex-1"}>
            {selected.kind === "camera" ? (
              <video ref={watchVideoRef} className="h-full w-full bg-ink object-contain" autoPlay playsInline />
            ) : (
              <YoutubeDock className="h-full w-full" />
            )}
            {selected.kind === "camera" && !selectedCamera?.stream ? (
              <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-on-photo">
                {playbackBadge(selectedCamera?.connection ?? "connecting").text}
              </div>
            ) : null}
            {selected.kind === "youtube" && youtubeState !== "playing" && youtubeState !== "paused" && youtubeState !== "idle" ? (
              <p className="pointer-events-none absolute inset-x-3 bottom-14 text-center text-sm text-on-photo">{youtubeState === "loading" || youtubeState === "buffering" ? "Loading YouTube…" : youtubeState === "ended" ? "This YouTube video has ended." : youtubeState}</p>
            ) : null}
          </div>
          {player === "mini" ? (
            <div className="absolute inset-x-1 bottom-1 flex items-center justify-between">
              <button type="button" className="inline-flex size-11 items-center justify-center rounded-full bg-ink/70 text-on-photo" aria-label="Stop watching" onClick={closeWatch}>
                <X className="size-4" aria-hidden />
              </button>
              <button type="button" className="inline-flex size-11 items-center justify-center rounded-full bg-ink/70 text-on-photo" aria-label="Expand live video" onClick={() => setPlayer("expanded")}>
                <Maximize2 className="size-4" aria-hidden />
              </button>
            </div>
          ) : (
            <div className="flex shrink-0 flex-col gap-2 bg-ink px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm text-on-photo">
                  {selected.kind === "youtube" ? "YouTube" : selectedCamera?.hostName || "Live"}
                  {selected.kind === "camera" && selectedCamera?.connection === "live" ? <span className="ml-2 rounded-full bg-maroon px-2 py-0.5 text-xs">LIVE{focusViewers ? ` · ${focusViewers}` : ""}</span> : selected.kind === "camera" ? <span className="ml-2 text-xs">{playbackBadge(selectedCamera?.connection ?? "connecting").text}</span> : null}
                </p>
                <span className="flex shrink-0 gap-1">
                  <button type="button" className="inline-flex size-11 items-center justify-center rounded-full bg-white/15 text-on-photo" aria-label="Minimize live video" onClick={minimizeWatch}>
                    <Minimize2 className="size-4" aria-hidden />
                  </button>
                  <button type="button" className="inline-flex min-h-11 items-center rounded-full bg-white/15 px-3 text-sm text-on-photo" onClick={closeWatch}>
                    Close
                  </button>
                </span>
              </div>
              {needsSound && selected.kind === "camera" ? (
                <button type="button" className="min-h-11 rounded-full bg-ivory text-sm text-ink" onClick={() => {
                  const video = watchVideoRef.current;
                  if (!video) return;
                  video.muted = false;
                  void video.play().then(() => setNeedsSound(false)).catch(() => undefined);
                }}>
                  Tap for sound
                </button>
              ) : null}
              {selected.kind === "youtube" ? (
                <button type="button" className="min-h-11 rounded-full bg-ivory text-sm text-ink" onClick={() => {
                  youtubeFrame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [], id: "wc-yt", channel: "widget" }), "*");
                  youtubeFrame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [], id: "wc-yt", channel: "widget" }), "*");
                }}>
                  Play YouTube
                </button>
              ) : null}
              {selected.kind === "camera" ? <LiveCommentTape chats={focusChats} /> : null}
              {selected.kind === "camera" && mayTalk ? (
                <form
                  className="flex gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const next = note.trim().slice(0, 240);
                    if (!next) return;
                    setNote("");
                    void sendRoom("comment", next);
                  }}
                >
                  <input className="min-h-11 w-full rounded-full bg-ivory/95 px-3 text-sm text-ink outline-none" maxLength={240} placeholder="Comment" value={note} onChange={(event) => setNote(event.target.value)} onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest" })} />
                  <Button type="submit">Send</Button>
                </form>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {phase === "idle" ? null : (
        <div
          ref={stageRef}
          data-noswipe=""
          className={minimized ? "fixed z-40 overflow-hidden rounded-2xl border border-white/40 bg-ink shadow-lg" : "broadcast-stage fixed inset-x-0 z-40 bg-ink"}
          style={minimized ? { left: pos.x, top: pos.y, width: 148, height: 230, touchAction: "none" } : { top: 0, height: "100dvh" }}
          onPointerDown={(event) => {
            if (!minimized) return;
            if ((event.target as HTMLElement).closest("button")) return;
            drag.current = { x: event.clientX, y: event.clientY, left: pos.x, top: pos.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            setPos({
              x: Math.min(window.innerWidth - 156, Math.max(8, start.left + event.clientX - start.x)),
              y: Math.min(window.innerHeight - 250, Math.max(8, start.top + event.clientY - start.y)),
            });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
        >
          <div className={minimized ? "relative h-full w-full" : "broadcast-frame"}>
            <div className={`absolute inset-0 overflow-hidden${facing === "user" ? " broadcast-mirror" : ""}`}>
              <video ref={previewRef} className="absolute inset-0 h-full w-full bg-ink object-cover" autoPlay muted playsInline disablePictureInPicture />
            </div>
            {phase === "live" ? (
              <LiveBroadcast
                slug={wedding.slug}
                name={viewer.name}
                codes={codes}
                publishing
                showLocal={false}
                localStream={streamRef.current}
                trackVersion={trackVersion}
                onPublishing={(on) => {
                  if (!on) setPhase("preview");
                }}
                onWatching={setWatching}
                onMedia={setMediaReady}
                onError={(message) => toast(message)}
                onRoom={applyRoom}
                externalMedia={kitMode === "realtimekit"}
                memberKey={memberKeyFor(wedding.slug)}
                access={JSON.stringify(wedding.liveAccess ?? { kind: "all" })}
                roster={JSON.stringify(wedding.guests.map((guest) => ({ name: guest.name, side: guest.side, allowBride: guest.allowBride, allowGroom: guest.allowGroom, allowCeremonies: guest.allowCeremonies })))}
              />
            ) : null}
            {minimized ? (
              <button type="button" className="absolute right-1.5 bottom-1.5 inline-flex size-11 items-center justify-center rounded-full bg-ink/70 text-on-photo" aria-label="Return to live" onClick={() => setMinimized(false)}>
                <Maximize2 className="size-4" aria-hidden />
              </button>
            ) : (
              <>
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
                  <div className="rounded-full bg-maroon px-3 py-1 text-sm text-on-photo">
                    {phase === "live" ? `LIVE${hostName ? ` · ${hostName}` : ""}` : "Preview"}
                    {kitStatus ? <span className="ml-2">{kitStatus}</span> : null}
                    {chosen ? <span className="ml-2">{chosen.name}</span> : null}
                    {phase === "live" && viewerCount !== null ? <span className="ml-2 tabular-nums">{viewerCount}</span> : null}
                  </div>
                  <button type="button" className="pointer-events-auto inline-flex size-12 items-center justify-center rounded-full border border-white/75 bg-black/35 text-on-photo shadow-[0_2px_8px_rgba(0,0,0,0.35)]" aria-label="Minimize live" onClick={minimize}>
                    <Minimize2 className="size-5" aria-hidden />
                  </button>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  {phase === "live" ? <LiveCommentTape chats={chats} /> : null}
                  {confirmingEnd ? (
                    <div className="pointer-events-auto rounded-2xl bg-ivory p-3 text-ink">
                      <p className="text-sm">End this live stream? Viewers will be disconnected.</p>
                      <div className="mt-2 flex gap-2">
                        <Button type="button" className="live-stop" onClick={() => void endBroadcast()} disabled={stopping}>{stopping ? "Stopping…" : "Stop Live"}</Button>
                        <Button type="button" variant="line" onClick={() => setConfirmingEnd(false)}>Keep going</Button>
                      </div>
                    </div>
                  ) : null}
                  {phase === "live" && mayTalk ? (
                    <form
                      className="pointer-events-auto flex gap-1.5"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const next = note.trim().slice(0, 240);
                        if (!next) return;
                        setNote("");
                        void sendRoom("comment", next);
                      }}
                    >
                      <input className="min-h-11 w-full rounded-full bg-ivory/95 px-3 text-sm text-ink outline-none" maxLength={240} placeholder="Comment" value={note} onChange={(event) => setNote(event.target.value)} onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest" })} />
                      <Button type="submit">Send</Button>
                    </form>
                  ) : null}
                  <div className="pointer-events-auto flex items-center justify-evenly">
                    <RoundControl label={cameraOn ? "Turn camera off" : "Turn camera on"} onClick={toggleCamera}>
                      {cameraOn ? <Video className="size-5" aria-hidden /> : <VideoOff className="size-5" aria-hidden />}
                    </RoundControl>
                    <RoundControl label={micOn ? "Mute microphone" : "Unmute microphone"} onClick={toggleMic}>
                      {micOn ? <Mic className="size-5" aria-hidden /> : <MicOff className="size-5" aria-hidden />}
                    </RoundControl>
                    <RoundControl label="Switch camera" onClick={() => void flipCamera()}>
                      <SwitchCamera className="size-5" aria-hidden />
                    </RoundControl>
                    {phase === "preview" ? (
                      <RoundControl label="Start live stream" primary onClick={goBroadcast}>
                        <Radio className="size-7" aria-hidden />
                      </RoundControl>
                    ) : (
                      <RoundControl label="End live" primary ending disabled={stopping} onClick={() => setConfirmingEnd(true)}>
                        <CircleStop className="size-7" aria-hidden />
                      </RoundControl>
                    )}
                    {phase === "preview" ? (
                      <RoundControl label="Cancel preview" onClick={releasePreview}>
                        <X className="size-5" aria-hidden />
                      </RoundControl>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </LiveSessionContext.Provider>
  );
}
