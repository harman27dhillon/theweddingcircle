import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clock, microphoneFailure, preferredMime } from "@/lib/wedding/capture";
import { deleteMediaBlob, resolveMediaUrl } from "@/lib/wedding/media-db";
import { forgetSharedMedia } from "@/lib/wedding/media-sync";
import { useWeddingStore } from "@/lib/wedding/store";

const activeAudio = { current: null as HTMLAudioElement | null };

function claim(audio: HTMLAudioElement) {
  if (activeAudio.current && activeAudio.current !== audio) activeAudio.current.pause();
  activeAudio.current = audio;
}

function stopRecorder(recorder: MediaRecorder | null) {
  if (!recorder || recorder.state === "inactive") return;
  try {
    recorder.stop();
  } catch {
    /* already stopped */
  }
}

export function VoiceControls({
  disabled,
  weddingId,
  onActive,
  stopSignal,
  onPublish,
}: {
  disabled: boolean;
  weddingId: string;
  onActive: (active: boolean) => void;
  stopSignal: number;
  onPublish: (input: { blob: Blob; seconds: number; src?: string }) => Promise<{ ok: boolean; error?: string; src?: string }>;
}) {
  const [mode, setMode] = useState<"idle" | "recording" | "preview">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const urlRef = useRef("");
  const srcRef = useRef("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const startingRef = useRef(false);
  const discardRef = useRef(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  function releaseMic() {
    stopRecorder(recorderRef.current);
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function discardPreview() {
    audioRef.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = "";
    blobRef.current = null;
    const saved = srcRef.current;
    srcRef.current = "";
    if (saved) {
      const wedding = useWeddingStore.getState().weddings.find((item) => item.id === weddingId);
      void deleteMediaBlob(saved);
      if (wedding) void forgetSharedMedia(wedding, saved);
    }
    setPlaying(false);
    setPosition(0);
  }

  function goIdle(message = "") {
    const recorder = recorderRef.current;
    discardRef.current = Boolean(recorder && recorder.state !== "inactive");
    releaseMic();
    discardPreview();
    setMode("idle");
    setElapsed(0);
    setError(message);
    onActive(false);
  }

  useEffect(() => {
    onActive(mode !== "idle");
  }, [mode, onActive]);

  useEffect(() => () => {
    releaseMic();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    onActive(false);
  }, [onActive]);

  useEffect(() => {
    if (stopSignal === 0) return;
    if (modeRef.current === "recording") stopRecorder(recorderRef.current);
    else releaseMic();
  }, [stopSignal]);

  useEffect(() => {
    if (mode !== "recording") return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const next = Math.round((Date.now() - started) / 1000);
      setElapsed(next);
      if (next >= 180) stopRecorder(recorderRef.current);
    }, 250);
    const onHide = () => {
      if (document.visibilityState === "hidden") stopRecorder(recorderRef.current);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [mode]);

  async function start() {
    if (startingRef.current || recorderRef.current || disabled || busy) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record voice notes.");
      return;
    }
    startingRef.current = true;
    setError("");
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError" || name === "NotFoundError") throw error;
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      if (modeRef.current === "recording") {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mime = preferredMime("audio", (type) => MediaRecorder.isTypeSupported(type));
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      const startedAt = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mime || "audio/webm" });
        chunksRef.current = [];
        if (discardRef.current) {
          discardRef.current = false;
          return;
        }
        const elapsedMs = Date.now() - startedAt;
        const interrupted = document.visibilityState === "hidden";
        if (blob.size < 200 || elapsedMs < 400) {
          setMode("idle");
          onActive(false);
          setError(interrupted ? "Recording stopped because the phone interrupted it." : "That recording was too short.");
          return;
        }
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        blobRef.current = blob;
        setSeconds(Math.max(1, Math.round(elapsedMs / 1000)));
        setMode("preview");
        setError(interrupted ? "Recording stopped because the phone interrupted it. You can still listen, send it, or record again." : "");
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start(200);
      setElapsed(0);
      setMode("recording");
    } catch (error) {
      releaseMic();
      setMode("idle");
      onActive(false);
      setError(microphoneFailure(error));
    } finally {
      startingRef.current = false;
    }
  }

  async function send() {
    const blob = blobRef.current;
    if (!blob || busy) return;
    setBusy(true);
    setError("");
    audioRef.current?.pause();
    try {
      const result = await onPublish({ blob, seconds, src: srcRef.current || undefined });
      if (result.src) srcRef.current = result.src;
      if (!result.ok) {
        setError(result.error || "That voice note could not be sent.");
        return;
      }
      srcRef.current = "";
      goIdle();
    } finally {
      setBusy(false);
    }
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      claim(audio);
      void audio.play().catch(() => setError("This recording could not be played."));
    } else {
      audio.pause();
    }
  }

  if (mode === "idle") {
    return (
      <span className="contents">
        <button
          type="button"
          className="chat-mic inline-flex size-9 shrink-0 items-center justify-center rounded-full"
          aria-label="Record a voice note"
          disabled={disabled}
          onClick={() => void start()}
        >
          <Mic className="size-4" aria-hidden />
        </button>
        {error ? <p className="basis-full px-1 text-xs text-maroon">{error}</p> : null}
      </span>
    );
  }

  if (mode === "recording") {
    return (
      <div className="flex min-h-9 min-w-0 flex-1 items-center gap-2" role="status" aria-live="polite">
        <span className="voice-live" aria-hidden />
        <span className="tabular-nums text-sm text-ink">{clock(elapsed)}</span>
        <button type="button" className="min-h-9 px-2 text-sm text-maroon" onClick={() => goIdle()}>
          Cancel
        </button>
        <button type="button" className="min-h-9 rounded-full bg-maroon px-3 text-sm text-on-photo" onClick={() => stopRecorder(recorderRef.current)}>
          Stop
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1">
        <button type="button" className="min-h-9 shrink-0 px-2 text-sm text-ink" aria-label={playing ? "Pause voice note" : "Play voice note"} onClick={togglePlay}>
          {playing ? "Pause" : "Play"}
        </button>
        <span className="shrink-0 tabular-nums text-xs text-muted">{clock(position)} / {clock(seconds)}</span>
        <input
          className="min-w-0 flex-1 accent-maroon"
          type="range"
          min={0}
          max={Math.max(seconds, 1)}
          step={0.1}
          value={Math.min(position, seconds)}
          aria-label="Voice note position"
          onChange={(event) => {
            const audio = audioRef.current;
            const next = Number(event.target.value);
            if (audio) audio.currentTime = next;
            setPosition(next);
          }}
        />
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        <button
          type="button"
          className="min-h-9 px-2 text-sm"
          disabled={busy}
          onClick={() => {
            discardPreview();
            setMode("idle");
            onActive(false);
            void start();
          }}
        >
          Record again
        </button>
        <button type="button" className="min-h-9 px-2 text-sm text-maroon" disabled={busy} onClick={() => goIdle()}>
          Delete
        </button>
        <button type="button" className="min-h-9 rounded-full bg-maroon px-3 text-sm text-on-photo disabled:opacity-50" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : "Send voice note"}
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-maroon">{error}</p> : null}
      {urlRef.current ? (
        <audio
          ref={audioRef}
          src={urlRef.current}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
          }}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        />
      ) : null}
    </div>
  );
}

export function VoiceBubble({ src, seconds, mine = false }: { src: string; seconds: number; mine?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(seconds);
  const [peaks, setPeaks] = useState<number[]>(() => evenBars(24));

  useEffect(() => {
    let cancel = false;
    const audio = audioRef.current;
    setFailed(false);
    setUrl("");
    setPeaks(evenBars(24));
    void resolveMediaUrl(src).then((next) => {
      if (cancel) return;
      if (!next) setFailed(true);
      else setUrl(next);
    });
    return () => {
      cancel = true;
      audio?.pause();
    };
  }, [src]);

  useEffect(() => {
    if (!url) return;
    let cancel = false;
    void readPeaks(url).then((next) => {
      if (!cancel && next) setPeaks(next);
    });
    return () => {
      cancel = true;
    };
  }, [url]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      claim(audio);
      void audio.play().catch(() => setFailed(true));
    } else {
      audio.pause();
    }
  }

  const total = Math.max(length || seconds, 0.1);
  const progress = Math.min(1, position / total);

  return (
    <div className="voice-note" style={mine ? { color: "inherit" } : undefined}>
      <button
        type="button"
        className="voice-play"
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        disabled={!url || failed}
        onClick={toggle}
      >
        {failed ? "!" : playing ? "II" : "▶"}
      </button>
      <span
        className="voice-bars"
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(position)}
        tabIndex={0}
        onClick={(event) => {
          const audio = audioRef.current;
          if (!audio) return;
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = box.width > 0 ? (event.clientX - box.left) / box.width : 0;
          audio.currentTime = Math.max(0, Math.min(total, ratio * total));
          setPosition(audio.currentTime);
        }}
        onKeyDown={(event) => {
          const audio = audioRef.current;
          if (!audio) return;
          const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (!step) return;
          event.preventDefault();
          audio.currentTime = Math.max(0, Math.min(total, audio.currentTime + step));
          setPosition(audio.currentTime);
        }}
      >
        {peaks.map((height, index) => (
          <i key={index} className={index / peaks.length < progress ? "is-on" : ""} style={{ height: `${Math.round(30 + height * 70)}%` }} />
        ))}
      </span>
      <span className="voice-time">{failed ? "—" : clock(length || seconds)}</span>
      {url ? (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
          }}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            if (Number.isFinite(event.currentTarget.duration)) setLength(Math.max(1, Math.round(event.currentTarget.duration)));
          }}
          onError={() => setFailed(true)}
        />
      ) : null}
      {!url && !failed ? <span className="sr-only">Loading voice note</span> : null}
    </div>
  );
}

function evenBars(count: number) {
  return Array.from({ length: count }, (_, index) => 0.35 + ((index * 17) % 10) / 20);
}

async function readPeaks(url: string) {
  const Context = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  try {
    const response = await fetch(url);
    const bytes = await response.arrayBuffer();
    const context = new Context();
    try {
      const buffer = await context.decodeAudioData(bytes.slice(0));
      const channel = buffer.getChannelData(0);
      const bars = 24;
      const size = Math.max(1, Math.floor(channel.length / bars));
      const peaks: number[] = [];
      for (let index = 0; index < bars; index += 1) {
        let peak = 0;
        const start = index * size;
        for (let sample = start; sample < Math.min(channel.length, start + size); sample += 24) {
          peak = Math.max(peak, Math.abs(channel[sample] || 0));
        }
        peaks.push(Math.min(1, peak));
      }
      return peaks;
    } finally {
      void context.close();
    }
  } catch {
    return null;
  }
}

