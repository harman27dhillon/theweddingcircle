import { SwitchCamera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cameraFailure, cameraReleaseDelay, type CameraFacing, clock, drawCameraFrame, fitFrame, frameCrop, openVideoTrack, otherFacing, preferredMime } from "@/lib/wedding/capture";
import { MEDIA_ACCEPT, mediaKindOf, unsupportedMediaMessage } from "@/lib/wedding/media";
import { Button } from "@/components/wedding/ui";

type Facing = CameraFacing;
type Shot = { kind: "image" | "video"; url: string; file: File };
type CaptureMode = "idle" | "arming" | "recording";

const FRAME_RATIOS = [
  { id: "9:16", w: 9, h: 16 },
  { id: "3:4", w: 3, h: 4 },
  { id: "1:1", w: 1, h: 1 },
  { id: "4:3", w: 4, h: 3 },
  { id: "16:9", w: 16, h: 9 },
] as const;
type FrameId = (typeof FRAME_RATIOS)[number]["id"];

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function withTimeout<T>(work: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new DOMException("The camera took too long.", "TimeoutError")), ms);
    work.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function CameraCapture({ onClose, onUse }: { onClose: () => void; onUse: (file: File) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const aliveRef = useRef(true);
  const shotRef = useRef<Shot | null>(null);
  const facingRef = useRef<Facing>("environment");
  const modeRef = useRef<CaptureMode>("idle");
  const holdTimer = useRef(0);
  const holding = useRef(false);
  const [facing, setFacing] = useState<Facing>("environment");
  const [phase, setPhase] = useState<"starting" | "live" | "preview" | "error">("starting");
  const [message, setMessage] = useState("");
  const [shot, setShot] = useState<Shot | null>(null);
  const [canSwitch, setCanSwitch] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [ready, setReady] = useState(false);
  const [frame, setFrame] = useState<FrameId>("9:16");
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const liveApi = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

  function dropShot() {
    if (shotRef.current) URL.revokeObjectURL(shotRef.current.url);
    shotRef.current = null;
    setShot(null);
  }

  function release() {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    stopStream(streamRef.current);
    streamRef.current = null;
    modeRef.current = "idle";
    setRecording(false);
  }

  function fail(error: unknown) {
    release();
    if (!aliveRef.current) return;
    setMessage(cameraFailure(error));
    setPhase("error");
  }

  async function start(nextFacing: Facing) {
    if (!liveApi) {
      setMessage("This browser cannot open a live camera preview. Use the phone camera instead, then confirm the picture before it is posted.");
      setPhase("error");
      return;
    }
    const previousFacing = facingRef.current;
    const hadCamera = Boolean(streamRef.current?.getVideoTracks().some((track) => track.readyState === "live"));
    const previousId = streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId ?? "";
    if (streamRef.current) {
      stopStream(streamRef.current);
      streamRef.current = null;
      if (hadCamera) await cameraReleaseDelay();
    }
    setPhase("starting");
    setReady(false);
    setMessage("");
    try {
      const track = await withTimeout(openVideoTrack(nextFacing, hadCamera ? previousId : ""), 12000);
      if (!aliveRef.current) {
        track.stop();
        return;
      }
      const stream = new MediaStream([track]);
      streamRef.current = stream;
      facingRef.current = nextFacing;
      setFacing(nextFacing);
      setPhase("live");
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const cameras = devices.filter((device) => device.kind === "videoinput");
      if (aliveRef.current) setCanSwitch(cameras.length !== 1);
    } catch (error) {
      if (hadCamera && aliveRef.current) {
        try {
          await cameraReleaseDelay();
          const restored = await withTimeout(openVideoTrack(previousFacing), 8000);
          if (!aliveRef.current) {
            restored.stop();
            return;
          }
          streamRef.current = new MediaStream([restored]);
          facingRef.current = previousFacing;
          setFacing(previousFacing);
          setPhase("live");
          setMessage("This device could not switch cameras. The current camera is still on.");
          return;
        } catch {
          /* The previous camera could not be reopened either. */
        }
      }
      fail(error);
    }
  }

  useEffect(() => {
    aliveRef.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const orientation = screen.orientation as { lock?: (mode: "portrait") => Promise<void> } | undefined;
    void orientation?.lock?.("portrait").catch(() => undefined);
    void start("environment");
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        const recorder = recorderRef.current;
        if (recorder && recorder.state === "recording") recorder.stop();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      aliveRef.current = false;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("visibilitychange", onHide);
      void screen.orientation?.unlock?.();
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      release();
      dropShot();
    };
    // The camera session starts once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (phase !== "live" || !video || !stream) return;
    const mark = () => {
      if (video.videoWidth > 1) setReady(true);
    };
    const bind = (fresh: boolean) => {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      if (fresh) video.srcObject = null;
      if (fresh || video.srcObject !== stream) video.srcObject = stream;
      const play = video.play();
      if (play) void play.catch(() => undefined);
    };
    video.addEventListener("loadedmetadata", mark);
    video.addEventListener("resize", mark);
    video.addEventListener("playing", mark);
    bind(false);
    const giveUp = window.setTimeout(() => {
      if (aliveRef.current && video.videoWidth === 0) {
        setMessage("The camera preview did not start.");
        setPhase("error");
        release();
      }
    }, 8000);
    const onOrient = () => {
      if (streamRef.current === stream) bind(true);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && stream.getVideoTracks().some((track) => track.readyState === "live")) onOrient();
    };
    screen.orientation?.addEventListener("change", onOrient);
    window.addEventListener("orientationchange", onOrient);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      video.removeEventListener("loadedmetadata", mark);
      video.removeEventListener("resize", mark);
      video.removeEventListener("playing", mark);
      screen.orientation?.removeEventListener("change", onOrient);
      window.removeEventListener("orientationchange", onOrient);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(giveUp);
    };
  }, [phase, facing]);

  useEffect(() => {
    const node = stageRef.current;
    if (phase !== "live" || !node) return;
    const measure = () => setStageSize({ w: node.clientWidth, h: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [phase]);

  function hold(next: Shot) {
    dropShot();
    shotRef.current = next;
    setShot(next);
    release();
    setPhase("preview");
  }

  async function takePhoto() {
    const video = videoRef.current;
    const track = streamRef.current?.getVideoTracks()[0];
    if (modeRef.current === "recording") return;
    if (!video || video.videoWidth < 2) {
      setMessage("The photo was not ready. Wait for the preview, then try again.");
      return;
    }
    let source: CanvasImageSource = video;
    let width = video.videoWidth;
    let height = video.videoHeight;
    let bitmap: ImageBitmap | null = null;
    if (track && typeof ImageCapture !== "undefined") {
      try {
        bitmap = await (new ImageCapture(track) as ImageCapture & { grabFrame: () => Promise<ImageBitmap> }).grabFrame();
        source = bitmap;
        width = bitmap.width;
        height = bitmap.height;
      } catch {
        bitmap = null;
      }
    }
    if (bitmap && video.videoWidth > 1 && video.videoHeight > 1) {
      const previewPortrait = video.videoHeight >= video.videoWidth;
      const bitmapPortrait = bitmap.height >= bitmap.width;
      if (previewPortrait !== bitmapPortrait) {
        bitmap.close();
        bitmap = null;
        source = video;
        width = video.videoWidth;
        height = video.videoHeight;
      }
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap?.close();
      return;
    }
    drawCameraFrame(ctx, source, width, height, facingRef.current, false, facingRef.current === "user", 0);
    bitmap?.close();
    const ratio = FRAME_RATIOS.find((item) => item.id === frame) ?? FRAME_RATIOS[0];
    const stage = stageRef.current;
    const crop = frameCrop(canvas.width, canvas.height, stage?.clientWidth ?? 0, stage?.clientHeight ?? 0, ratio.w, ratio.h);
    const sx = Math.max(0, Math.round(crop.x));
    const sy = Math.max(0, Math.round(crop.y));
    const sw = Math.max(2, Math.min(canvas.width - sx, Math.round(crop.width)));
    const sh = Math.max(2, Math.min(canvas.height - sy, Math.round(crop.height)));
    const out = document.createElement("canvas");
    out.width = sw;
    out.height = sh;
    const outCtx = out.getContext("2d");
    if (!outCtx) return;
    outCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    out.toBlob((blob) => {
      if (!aliveRef.current) return;
      if (!blob) {
        setMessage("That photo could not be captured.");
        setPhase("error");
        release();
        return;
      }
      const file = new File([blob], "camera.jpg", { type: "image/jpeg" });
      hold({ kind: "image", url: URL.createObjectURL(blob), file });
    }, "image/jpeg", 0.92);
  }

  function beginRecord() {
    const stream = streamRef.current;
    const video = videoRef.current;
    if (!holding.current || modeRef.current !== "arming") {
      if (modeRef.current === "arming") modeRef.current = "idle";
      return;
    }
    if (!stream || !video || typeof MediaRecorder === "undefined") {
      modeRef.current = "idle";
      setMessage("This browser cannot record video from the camera. You can still take a photo.");
      return;
    }
    const recordStream = stream;
    const mime = preferredMime("video", (type) => MediaRecorder.isTypeSupported(type));
    let recorder: MediaRecorder;
    try {
      const withRate: MediaRecorderOptions = mime
        ? { mimeType: mime, videoBitsPerSecond: 4_000_000 }
        : { videoBitsPerSecond: 4_000_000 };
      try {
        recorder = new MediaRecorder(recordStream, withRate);
      } catch {
        recorder = mime ? new MediaRecorder(recordStream, { mimeType: mime }) : new MediaRecorder(recordStream);
      }
    } catch {
      modeRef.current = "idle";
      setMessage("This browser cannot record video from the camera. You can still take a photo.");
      return;
    }
    chunksRef.current = [];
    const started = Date.now();
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      recordStream.getVideoTracks().forEach((track) => {
        if (!stream.getVideoTracks().includes(track)) track.stop();
      });
      modeRef.current = "idle";
      setRecording(false);
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
      chunksRef.current = [];
      if (!aliveRef.current) return;
      if (blob.size < 200) {
        setMessage(document.visibilityState === "hidden" ? "Recording stopped because the phone interrupted it." : "That video was too short.");
        return;
      }
      const type = blob.type || "video/webm";
      const ext = type.includes("mp4") ? "mp4" : "webm";
      const file = new File([blob], `camera.${ext}`, { type });
      Object.defineProperty(file, "wcSeconds", { value: Math.max(1, Math.round((Date.now() - started) / 1000)) });
      hold({ kind: "video", url: URL.createObjectURL(blob), file });
    };
    recorderRef.current = recorder;
    try {
      recorder.start(250);
    } catch {
      modeRef.current = "idle";
      setMessage("This browser cannot record video from the camera. You can still take a photo.");
      return;
    }
    modeRef.current = "recording";
    setRecording(true);
    setElapsed(0);
    if (!holding.current) recorder.stop();
  }

  function armShutter(pointerId: number, node: HTMLButtonElement) {
    if (!ready || modeRef.current !== "idle") return;
    holding.current = true;
    modeRef.current = "arming";
    node.setPointerCapture(pointerId);
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = 0;
      if (!streamRef.current?.getAudioTracks().length) {
        void navigator.mediaDevices.getUserMedia({ audio: true }).then((audio) => {
          if (!aliveRef.current || modeRef.current !== "arming") {
            stopStream(audio);
            return;
          }
          audio.getAudioTracks().forEach((track) => streamRef.current?.addTrack(track));
          beginRecord();
        }).catch(() => {
          if (modeRef.current === "arming") beginRecord();
        });
        return;
      }
      beginRecord();
    }, 320);
  }

  function releaseShutter() {
    holding.current = false;
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = 0;
      if (modeRef.current === "arming") {
        modeRef.current = "idle";
        takePhoto();
      }
      return;
    }
    if (modeRef.current === "recording") recorderRef.current?.stop();
    else if (modeRef.current === "arming") modeRef.current = "idle";
  }

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  function acceptFile(file: File | undefined) {
    if (!file) return;
    if (file.size <= 0) {
      setMessage("That file was empty.");
      setPhase("error");
      return;
    }
    const kind = mediaKindOf(file);
    if (!kind) {
      setMessage(unsupportedMediaMessage(file));
      setPhase("error");
      return;
    }
    hold({ kind, url: URL.createObjectURL(file), file });
  }

  const ratio = FRAME_RATIOS.find((item) => item.id === frame) ?? FRAME_RATIOS[0];
  const guide = stageSize.w > 2 && stageSize.h > 2 && !recording ? fitFrame(stageSize.w, stageSize.h, ratio.w, ratio.h) : null;

  const node = (
    <div className="fixed inset-0 z-[90] bg-ink text-on-photo" role="dialog" aria-modal="true" aria-label="Camera" data-noswipe="">
      {phase === "live" ? (
        <div ref={stageRef} className="camera-fill">
          <div className={`camera-mirror${facing === "user" ? " is-mirrored" : ""}`}>
            <video
              ref={videoRef}
              className="camera-live"
              data-camera-live=""
              muted
              autoPlay
              playsInline
              disablePictureInPicture
            />
          </div>
          {guide ? (
            <div
              className="pointer-events-none absolute border border-white/80 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]"
              style={{ left: guide.x, top: guide.y, width: guide.width, height: guide.height }}
            />
          ) : null}
          {recording ? <span className="absolute top-16 left-4 z-[2] rounded-full bg-maroon px-2.5 py-1 text-xs">REC {clock(elapsed)}</span> : null}
        </div>
      ) : null}
      {phase === "preview" && shot?.kind === "image" ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <img src={shot.url} alt="Captured photo" className="max-h-full max-w-full object-contain" />
        </div>
      ) : null}
      {phase === "preview" && shot?.kind === "video" ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <video src={shot.url} className="max-h-full max-w-full object-contain" controls playsInline />
        </div>
      ) : null}
      {phase === "starting" || phase === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
          {phase === "starting" ? <p className="text-sm">Opening the camera…</p> : (
            <div className="max-w-sm">
              <p>{message}</p>
              <p className="mt-2 text-sm text-on-photo/80">You can try again, or open the phone camera and confirm the picture before it uploads.</p>
            </div>
          )}
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <div className="pointer-events-auto flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
          <p className="text-sm">{recording ? `Recording ${clock(elapsed)}` : phase === "preview" ? "Check this before posting" : "Camera"}</p>
          <button type="button" className="min-h-11 px-2 text-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1" />
        <div className="pointer-events-auto px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {phase === "live" && !recording ? (
            <div role="group" aria-label="Photo frame" className="mb-3 flex items-center justify-center gap-1.5">
              {FRAME_RATIOS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={frame === item.id}
                  aria-label={`Photo frame ${item.id}`}
                  className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-2.5 text-xs font-medium ${frame === item.id ? "bg-ivory text-ink" : "border border-white/70 bg-black/35 text-on-photo"}`}
                  onClick={() => setFrame(item.id)}
                >
                  {item.id}
                </button>
              ))}
            </div>
          ) : null}
          {phase === "live" && recording ? <p className="mb-3 text-center text-sm">Video uses the full camera</p> : null}
          {phase === "live" ? (
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div>
                {canSwitch ? (
                  <button
                    type="button"
                    className="inline-flex size-11 items-center justify-center rounded-full border border-white/70 bg-black/35"
                    aria-label="Switch camera"
                    disabled={recording || modeRef.current === "arming"}
                    onClick={() => void start(otherFacing(facing))}
                  >
                    <SwitchCamera className="size-5" aria-hidden />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                className={`capture-shutter${recording ? " is-recording" : ""}`}
                aria-label={recording ? "Release to stop recording" : "Take photo. Hold to record video."}
                disabled={!ready}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  armShutter(event.pointerId, event.currentTarget);
                }}
                onPointerUp={releaseShutter}
                onPointerCancel={releaseShutter}
                onContextMenu={(event) => event.preventDefault()}
              />
              <div className="text-right">
                <button type="button" className="min-h-11 px-2 text-sm" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {phase === "preview" && shot ? (
            <div className="flex flex-wrap items-center justify-center gap-3">
              {shot.kind === "video" ? <p className="w-full text-center text-sm text-on-photo/80">Play the video above, then keep it or record again.</p> : null}
              <Button type="button" variant="line" onClick={() => { dropShot(); void start(facingRef.current); }}>
                {shot.kind === "video" ? "Record again" : "Retake"}
              </Button>
              <Button type="button" variant="quiet" className="text-on-photo" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const file = shot.file;
                  release();
                  onUse(file);
                }}
              >
                {shot.kind === "video" ? "Use video" : "Use photo"}
              </Button>
            </div>
          ) : null}
          {phase === "error" || phase === "starting" ? (
            <div className="flex flex-wrap items-center justify-center gap-3">
              {phase === "error" && liveApi ? (
                <Button type="button" onClick={() => void start(facingRef.current)}>
                  Try again
                </Button>
              ) : null}
              <Button type="button" variant="line" onClick={() => fileRef.current?.click()}>
                Open phone camera
              </Button>
              <Button type="button" variant="quiet" className="text-on-photo" onClick={onClose}>
                Back to Chat
              </Button>
            </div>
          ) : null}
          {message && phase === "live" ? <p className="pt-3 text-center text-sm">{message}</p> : null}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={MEDIA_ACCEPT}
        capture="environment"
        className="sr-only"
        aria-label="Open phone camera"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          acceptFile(file);
        }}
      />
    </div>
  );

  return createPortal(node, document.body);
}
