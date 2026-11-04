import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Music, Volume2, VolumeX } from "lucide-react";

const TRACK_KEY = "wc-theme-music-track";
const LEVEL = 0.1;

type CatalogTrack = { id: string; title: string; src: string };

type MusicApi = {
  tracks: CatalogTrack[];
  playing: boolean;
  muted: boolean;
  failed: boolean;
  trackId: string;
  toggle: () => void;
  choose: (id: string) => void;
  refresh: () => void;
};

const MusicContext = createContext<MusicApi | null>(null);

function storedTrack() {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(TRACK_KEY) || "";
  } catch {
    return "";
  }
}

function asTracks(value: unknown): CatalogTrack[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is CatalogTrack => {
      if (!item || typeof item !== "object") return false;
      const track = item as CatalogTrack;
      return typeof track.id === "string" && typeof track.title === "string" && typeof track.src === "string" && track.src.startsWith("/api/music/file/");
    })
    .slice(0, 20);
}

export function ThemeMusicProvider({ children }: { children: ReactNode }) {
  const [tracks, setTracks] = useState<CatalogTrack[]>([]);
  const [chosen, setChosen] = useState("");
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const active = tracks.find((track) => track.id === chosen) ?? null;
  const src = active?.src ?? null;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeRef = useRef(0);
  const srcRef = useRef<string | null>(src);
  const wantRef = useRef(false);
  const unlockedRef = useRef(false);
  const failedRef = useRef(false);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  srcRef.current = src;

  function fade(audio: HTMLAudioElement, target: number, done?: () => void) {
    window.clearInterval(fadeRef.current);
    fadeRef.current = window.setInterval(() => {
      const next = audio.volume + (target - audio.volume) * 0.45;
      if (Math.abs(target - next) < 0.012) {
        audio.volume = target;
        window.clearInterval(fadeRef.current);
        done?.();
        return;
      }
      audio.volume = next;
    }, 40);
  }

  function stop(audio: HTMLAudioElement | null) {
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
  }

  function play(audio: HTMLAudioElement, next: string) {
    void audio.play().then(() => {
      if (srcRef.current !== next || !wantRef.current || audioRef.current !== audio) {
        audio.pause();
        return;
      }
      failedRef.current = false;
      setFailed(false);
      setPlaying(true);
      fade(audio, LEVEL);
    }).catch((error: unknown) => {
      if (audioRef.current !== audio) return;
      setPlaying(false);
      const name = error && typeof error === "object" && "name" in error ? String((error as { name: string }).name) : "";
      if (name !== "NotAllowedError") {
        failedRef.current = true;
        setFailed(true);
      }
    });
  }

  function arm(next: string | null) {
    const current = audioRef.current;
    if (!next || !wantRef.current) {
      window.clearInterval(fadeRef.current);
      if (!next) {
        stop(current);
        audioRef.current = null;
      } else if (current && !current.paused) {
        current.pause();
      }
      setPlaying(false);
      return;
    }
    if (current?.dataset.track === next) {
      if (unlockedRef.current && current.paused) play(current, next);
      return;
    }
    const previous = current;
    const audio = new Audio(next);
    audio.loop = true;
    audio.preload = "none";
    audio.volume = 0;
    audio.dataset.track = next;
    audio.addEventListener("error", () => {
      if (audioRef.current !== audio) return;
      failedRef.current = true;
      setPlaying(false);
      setFailed(true);
    });
    audioRef.current = audio;
    failedRef.current = false;
    setFailed(false);
    if (previous && previous !== audio) {
      fade(previous, 0, () => stop(previous));
    }
    if (!unlockedRef.current) {
      setPlaying(false);
      return;
    }
    play(audio, next);
  }

  function pull() {
    void fetch("/api/music/tracks", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { ok?: boolean; tracks?: unknown } | null) => {
        if (!body || body.ok === false) {
          setTracks([]);
          return;
        }
        const next = asTracks(body.tracks);
        setTracks(next);
        setChosen((current) => {
          const saved = current || storedTrack();
          if (next.some((track) => track.id === saved)) return saved;
          try {
            localStorage.removeItem(TRACK_KEY);
          } catch {
            /* the empty library still stands */
          }
          return "";
        });
      })
      .catch(() => {
        setTracks([]);
      });
  }

  useEffect(() => {
    pull();
    const poke = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".theme-audio")) return;
      unlockedRef.current = true;
    };
    window.addEventListener("pointerdown", poke);
    window.addEventListener("focus", pull);
    return () => {
      window.removeEventListener("pointerdown", poke);
      window.removeEventListener("focus", pull);
      window.clearInterval(fadeRef.current);
      stop(audioRef.current);
      audioRef.current = null;
    };
    // The player stays mounted for the wedding visit and always starts muted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    arm(src);
    // arm closes over the latest refs. Recreating it each render must not restart a playing track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  function toggle() {
    unlockedRef.current = true;
    if (!srcRef.current) {
      wantRef.current = false;
      setMuted(true);
      setPlaying(false);
      return;
    }
    if (wantRef.current && failedRef.current) {
      const broken = audioRef.current;
      audioRef.current = null;
      stop(broken);
      failedRef.current = false;
      setFailed(false);
      arm(srcRef.current);
      return;
    }
    const next = !wantRef.current;
    wantRef.current = next;
    setMuted(!next);
    const audio = audioRef.current;
    if (!next) {
      if (!audio) {
        setPlaying(false);
        return;
      }
      fade(audio, 0, () => {
        audio.pause();
        setPlaying(false);
      });
      return;
    }
    arm(srcRef.current);
  }

  function choose(id: string) {
    const track = tracksRef.current.find((item) => item.id === id);
    if (!track) return;
    setChosen(id);
    srcRef.current = track.src;
    try {
      localStorage.setItem(TRACK_KEY, id);
    } catch {
      /* the choice still applies for this visit */
    }
    if (!wantRef.current) return;
    unlockedRef.current = true;
    arm(track.src);
  }

  return (
    <MusicContext.Provider value={{ tracks, playing, muted, failed, trackId: chosen, toggle, choose, refresh: pull }}>
      {children}
    </MusicContext.Provider>
  );
}

export function ThemeSoundWaves() {
  const api = useContext(MusicContext);
  if (!api || api.muted || api.failed || !api.playing) return null;
  return (
    <div className="chat-waves" aria-hidden="true">
      <span className="chat-wave chat-wave-top" />
      <span className="chat-wave chat-wave-right" />
      <span className="chat-wave chat-wave-bottom" />
      <span className="chat-wave chat-wave-left" />
    </div>
  );
}

export function ThemeSpeaker() {
  const api = useContext(MusicContext);
  const [open, setOpen] = useState(false);
  if (!api) return null;
  const on = !api.muted && !api.failed && Boolean(api.trackId);
  const label = on ? "Mute background music" : "Unmute background music";
  return (
    <div className="theme-audio">
      {open ? (
        <ul className="theme-track-list" role="listbox" aria-label="Background music">
          {api.tracks.length === 0 ? <li className="theme-track-empty">No music has been added yet.</li> : null}
          {api.tracks.map((track) => (
            <li key={track.id}>
              <button
                type="button"
                role="option"
                aria-selected={track.id === api.trackId}
                className={track.id === api.trackId ? "is-on" : undefined}
                onClick={() => {
                  api.choose(track.id);
                  setOpen(false);
                }}
              >
                {track.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className="theme-tracks"
        aria-label="Choose background music"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          api.refresh();
        }}
      >
        <Music className="size-4" aria-hidden />
      </button>
      <button type="button" className="theme-speaker" aria-label={label} aria-pressed={on} onClick={api.toggle}>
        {on ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
