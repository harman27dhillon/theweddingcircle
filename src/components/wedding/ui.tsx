import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type VideoHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Eye, EyeOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDismissible } from "@/lib/wedding/dismiss";
import { mediaAfterImageError, type MediaAttempt } from "@/lib/wedding/media-load";
import { dropResolvedMedia } from "@/lib/wedding/r2-upload";
import { nextSwipeIndex } from "@/lib/wedding/swipe";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet" | "line";
};

export function Button({ variant = "primary", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition hover:opacity-90 active:opacity-80 disabled:opacity-50",
        variant === "primary" && "bg-maroon text-on-photo hover:opacity-90",
        variant === "quiet" && "bg-transparent text-ink hover:bg-paper",
        variant === "line" && "border border-line bg-card text-ink hover:border-maroon",
        className,
      )}
      {...props}
    />
  );
}

export function PasswordField({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <input {...props} type={visible ? "text" : "password"} className={cn(fieldClass, "pr-12", className)} />
      <button
        type="button"
        className="absolute inset-y-0 right-2 inline-flex min-w-10 items-center justify-center rounded-full text-muted hover:text-maroon"
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
      </button>
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-muted">{label}</span>
      {children}
    </label>
  );
}

export const fieldClass =
  "w-full rounded-2xl border border-line bg-card px-3 py-3 text-base text-ink outline-none placeholder:text-muted focus:border-maroon";

export function PickList<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <label className="block min-w-0">
      {label ? <span className="mb-1.5 block text-sm text-muted">{label}</span> : null}
      <select className={cn(fieldClass, className)} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function IconPop({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismissible(open, () => setOpen(false), root);
  return (
    <div className="relative shrink-0" ref={root}>
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        className="inline-flex size-9 items-center justify-center rounded-full border border-line/80 bg-card text-maroon"
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
      </button>
      {open ? (
        <div className="wc-pop absolute bottom-full left-0 z-30 mb-2 w-60 rounded-2xl border border-gold/50 bg-paper p-2 text-ink shadow-[0_16px_36px_-24px_color-mix(in_srgb,var(--color-ink)_45%,transparent)]">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#f4efe8" />
      <circle cx="16" cy="16" r="9.2" fill="none" stroke="#a68456" strokeWidth="2.25" />
      <circle cx="16" cy="16" r="3.1" fill="#8c2f39" />
    </svg>
  );
}

export function Screen({
  title,
  lede,
  action,
  children,
  className,
}: {
  title: string;
  lede?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-8 lg:max-w-5xl", className)}>
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-ink md:text-4xl">{title}</h1>
          {lede ? <p className="mt-2 max-w-xl text-muted">{lede}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-card border border-dashed border-line bg-paper px-5 py-8">
      <p className="font-serif text-xl text-ink">{title}</p>
      <p className="mt-2 text-muted">{text}</p>
    </div>
  );
}

let mediaDbMod: typeof import("@/lib/wedding/media-db") | null = null;
let mediaDbPromise: Promise<typeof import("@/lib/wedding/media-db")> | null = null;
function loadMediaDb() {
  mediaDbPromise ??= import("@/lib/wedding/media-db").then((mod) => {
    mediaDbMod = mod;
    return mod;
  });
  return mediaDbPromise;
}

let googleUploadPromise: Promise<typeof import("@/lib/google/upload")> | null = null;
function loadGoogleUpload() {
  googleUploadPromise ??= import("@/lib/google/upload");
  return googleUploadPromise;
}

let r2UploadPromise: Promise<typeof import("@/lib/wedding/r2-upload")> | null = null;
function loadR2Upload() {
  r2UploadPromise ??= import("@/lib/wedding/r2-upload");
  return r2UploadPromise;
}

export function useMediaUrl(src?: string, variant: "full" | "preview" = "full", reload = 0) {
  const [url, setUrl] = useState(() => {
    if (src?.startsWith("r2:") && variant === "preview") return mediaDbMod?.cachedLocalThumbUrl(src.slice(3)) || "";
    if (!src || src.startsWith("gp:") || src.startsWith("r2:") || variant === "preview") return "";
    if (src.startsWith("idb:")) return mediaDbMod?.cachedMediaUrl(src) ?? "";
    return src;
  });
  const [note, setNote] = useState("");
  const [stamp, setStamp] = useState(0);
  useEffect(() => {
    if (!src) {
      setUrl("");
      setNote("");
      setStamp(reload);
      return;
    }
    if (src.startsWith("r2:")) {
      let cancel = false;
      setUrl(variant === "preview" ? mediaDbMod?.cachedLocalThumbUrl(src.slice(3)) || "" : "");
      setNote("");
      const load = async () => {
        if (variant === "preview") {
          const db = await loadMediaDb();
          const local = await db.localThumbUrl(src.slice(3)).catch(() => "");
          if (local) return { url: local, note: "" };
        }
        return (await loadR2Upload()).resolveR2Media(src, variant);
      };
      void load().then((next) => {
        if (cancel) return;
        setUrl(next.url);
        setNote(next.note);
        setStamp(reload);
        if (variant === "preview" && !next.url && !next.note) {
          window.setTimeout(() => {
            if (cancel) return;
            void load().then((again) => {
              if (cancel || !again.url) return;
              setUrl(again.url);
              setStamp(reload + 1);
            });
          }, 2500);
        }
      });
      return () => {
        cancel = true;
      };
    }
    if (src.startsWith("gp:")) {
      let cancel = false;
      setUrl("");
      setNote("");
      void loadGoogleUpload().then((mod) => mod.resolveGoogleMedia(src)).then((next) => {
        if (cancel) return;
        setUrl(next.url);
        setNote(next.note);
        setStamp(reload);
      });
      return () => {
        cancel = true;
      };
    }
    if (!src.startsWith("idb:")) {
      setUrl(src);
      setNote("");
      setStamp(reload);
      return;
    }
    let cancel = false;
    void loadMediaDb().then((mod) => {
      const known = mod.cachedMediaUrl(src);
      if (known) {
        if (!cancel) {
          setUrl(known);
          setNote("");
          setStamp(reload);
        }
        return;
      }
      return mod.resolveMediaUrl(src).then((next) => {
        if (cancel) return;
        if (next) {
          setUrl(next);
          setNote("");
        } else {
          setUrl("");
          setNote("That file could not be opened.");
        }
        setStamp(reload);
      });
    });
    return () => {
      cancel = true;
    };
  }, [src, variant, reload]);
  return { url, note, stamp };
}

const quietAttempt: MediaAttempt = { full: false, tries: 0, failed: false };

export function Photo({
  src,
  alt,
  className,
  preview = false,
}: {
  src: string;
  alt: string;
  className?: string;
  preview?: boolean;
}) {
  const [reload, setReload] = useState(0);
  const [attempt, setAttempt] = useState<MediaAttempt>(quietAttempt);
  const attemptRef = useRef(attempt);
  const handled = useRef("");
  const [hold, setHold] = useState(false);
  const variant = preview && !attempt.full ? "preview" : "full";
  const { url, note, stamp } = useMediaUrl(src, variant, reload);
  useEffect(() => {
    attemptRef.current = quietAttempt;
    setAttempt(quietAttempt);
    handled.current = "";
    setHold(false);
  }, [src]);
  useEffect(() => {
    setHold(false);
  }, [stamp]);
  function onBroken() {
    const mark = `${variant}:${url}`;
    if (!url || handled.current === mark) return;
    handled.current = mark;
    const next = mediaAfterImageError(attemptRef.current, preview);
    attemptRef.current = next;
    setAttempt(next);
    dropResolvedMedia(src, next.drop === "both" ? undefined : next.drop);
    if (!next.failed) {
      setHold(true);
      setReload((value) => value + 1);
    }
  }
  if (note || attempt.failed) {
    return (
      <button
        type="button"
        className={cn("bg-paper px-3 py-4 text-left text-sm text-muted", className)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          dropResolvedMedia(src);
          attemptRef.current = quietAttempt;
          setAttempt(quietAttempt);
          handled.current = "";
          setHold(false);
          setReload((value) => value + 1);
        }}
      >
        Could not load. Retry
      </button>
    );
  }
  if (hold || !url) return <div className={cn("bg-paper", className)} aria-busy="true" aria-label="Loading" />;
  const inChat = className?.includes("chat-media-fit");
  return <img src={url} alt={alt} className={cn(inChat ? "bg-transparent object-contain" : "bg-paper object-cover", className)} loading="lazy" decoding="async" crossOrigin={src.startsWith("r2:") && url.startsWith("http") ? "anonymous" : undefined} onLoad={(event) => {
    if (!src.startsWith("r2:")) return;
    const image = event.currentTarget;
    void loadMediaDb().then((db) => db.saveLoadedMediaThumb(src, image, image.naturalWidth, image.naturalHeight));
  }} onError={onBroken} />;
}

export function Clip({
  src,
  className,
  controls = true,
  autoPlay = false,
  loop = false,
  muted = false,
  framed = false,
}: {
  src: string;
  className?: string;
  framed?: boolean;
} & Pick<VideoHTMLAttributes<HTMLVideoElement>, "controls" | "autoPlay" | "loop" | "muted">) {
  const [reload, setReload] = useState(0);
  const { url, note } = useMediaUrl(src, "full", reload);
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState("");
  useEffect(() => {
    setFailed(false);
    setRatio("");
  }, [url]);
  if (note || failed) {
    return (
      <button type="button" className={cn(framed ? "h-full w-full bg-ink px-1 py-2 text-left text-[10px] text-on-photo" : "bg-ink px-4 py-6 text-left text-sm text-on-photo", className)} onClick={() => { setFailed(false); setReload((value) => value + 1); }}>
        Could not play. Retry
      </button>
    );
  }
  if (!url) return <div className={cn(framed ? "h-full w-full bg-ink" : "bg-ink", className)} aria-busy="true" aria-label="Loading" />;
  const inChat = className?.includes("chat-media-fit");
  return (
    <video
      src={url}
      className={cn(inChat ? "block h-auto w-auto max-w-full bg-transparent object-contain" : framed ? "h-full w-full max-w-full bg-ink object-cover object-center" : "block h-auto w-full max-w-full bg-ink object-contain", className)}
      style={framed || !ratio ? undefined : { aspectRatio: ratio }}
      preload={inChat ? "metadata" : undefined}
      controls={controls}
      autoPlay={autoPlay}
      loop={loop}
      muted={muted}
      playsInline
      crossOrigin={src.startsWith("r2:") && url.startsWith("http") ? "anonymous" : undefined}
      onLoadedData={(event) => {
        const video = event.currentTarget;
        void loadMediaDb().then((db) => db.saveLoadedMediaThumb(src, video, video.videoWidth, video.videoHeight));
      }}
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (video.videoWidth > 0 && video.videoHeight > 0) setRatio(`${video.videoWidth} / ${video.videoHeight}`);
      }}
      onError={() => setFailed(true)}
    />
  );
}

function usePreviewHistory(onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    const onPop = () => closeRef.current();
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    history.pushState({ wcPreview: true }, "");
    return () => {
      alive.current = false;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      queueMicrotask(() => {
        if (alive.current) return;
        if (history.state?.wcPreview) history.back();
      });
    };
  }, []);
  return () => {
    if (history.state?.wcPreview) {
      history.back();
      return;
    }
    closeRef.current();
  };
}

export function Lightbox({
  src,
  caption,
  onClose,
}: {
  src: string;
  caption?: string;
  onClose: () => void;
}) {
  const [reload, setReload] = useState(0);
  const { url, note } = useMediaUrl(src, "full", reload);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const close = usePreviewHistory(onClose);

  return createPortal(
    <div className="media-preview" role="dialog" aria-modal="true" aria-label={caption || "Photo"} data-noswipe="" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="media-preview-x" aria-label="Close" onClick={close}>
        <X className="size-5" aria-hidden />
      </button>
      <div className="media-preview-stage">
        {note || failed ? (
          <button type="button" className="max-w-lg text-center text-on-photo" onClick={() => { setFailed(false); setReload((value) => value + 1); }}>
            Could not load. Retry
          </button>
        ) : url ? <img src={url} alt={caption || "Wedding photo"} onError={() => setFailed(true)} /> : <p className="text-on-photo">Loading</p>}
      </div>
    </div>,
    document.body,
  );
}

export function MediaGroupView({
  tiles,
  start,
  onClose,
}: {
  tiles: { kind: "image" | "video"; src: string; caption?: string }[];
  start: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() => Math.min(Math.max(0, start), Math.max(0, tiles.length - 1)));
  const close = usePreviewHistory(onClose);
  const drag = useRef<{ x: number; y: number; t: number } | null>(null);
  const tile = tiles[index];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLMediaElement || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
      if (event.key === "ArrowRight") setIndex((value) => Math.min(tiles.length - 1, value + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tiles.length]);
  if (!tile) return null;
  return createPortal(
    <div className="media-preview" role="dialog" aria-modal="true" aria-label={tile.caption || "Photos and videos"} data-noswipe="" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="media-preview-x" aria-label="Close" onClick={close}>
        <X className="size-5" aria-hidden />
      </button>
      <div
        className="media-preview-stage"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const target = event.target;
          if (!(target instanceof Element) || target.closest("button, video, a, input")) return;
          drag.current = { x: event.clientX, y: event.clientY, t: performance.now() };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          const startAt = drag.current;
          drag.current = null;
          if (!startAt) return;
          const next = nextSwipeIndex(index, event.clientX - startAt.x, event.clientY - startAt.y, performance.now() - startAt.t, tiles.length);
          if (next !== index) setIndex(next);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        {tile.kind === "video" ? <Clip key={tile.src} src={tile.src} autoPlay={false} className="media-preview-video" /> : <Photo key={tile.src} src={tile.src} alt={tile.caption || ""} />}
      </div>
      {index > 0 ? (
        <button type="button" className="media-preview-arrow is-prev" aria-label="Previous" onClick={() => setIndex((value) => Math.max(0, value - 1))}>
          <ChevronLeft className="size-6" aria-hidden />
        </button>
      ) : null}
      {index < tiles.length - 1 ? (
        <button type="button" className="media-preview-arrow is-next" aria-label="Next" onClick={() => setIndex((value) => Math.min(tiles.length - 1, value + 1))}>
          <ChevronRight className="size-6" aria-hidden />
        </button>
      ) : null}
      {tiles.length > 1 ? <p className="media-preview-count">{index + 1} / {tiles.length}</p> : null}
    </div>,
    document.body,
  );
}

export function InlineMedia({ kind, src }: { kind: "photo" | "video"; src: string }) {
  const [open, setOpen] = useState(false);
  const preview = useMediaUrl(kind === "video" ? src : "", "preview");
  return (
    <>
      {kind === "photo" ? (
        <button type="button" className="chat-media" aria-label="View photo" onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
          <Photo src={src} alt="" preview className="chat-media-fit object-contain" />
        </button>
      ) : (
        <div className="chat-media">
          {preview.url ? (
            <img src={preview.url} alt="" className="chat-media-fit object-contain" />
          ) : (
            <Clip src={src} autoPlay={false} muted controls={false} className="chat-media-fit pointer-events-none object-contain" />
          )}
          <button type="button" className="chat-media-play" aria-label="Play video" onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
            <span aria-hidden="true">▶</span>
          </button>
        </div>
      )}
      {open && kind === "photo" ? <Lightbox src={src} onClose={() => setOpen(false)} /> : null}
      {open && kind === "video" ? <VideoPreview src={src} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function VideoPreview({ src, onClose }: { src: string; onClose: () => void }) {
  const close = usePreviewHistory(onClose);
  return createPortal(
    <div className="media-preview" role="dialog" aria-modal="true" aria-label="Video" data-noswipe="" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="media-preview-x" aria-label="Close" onClick={close}>
        <X className="size-5" aria-hidden />
      </button>
      <div className="media-preview-stage">
        <Clip src={src} autoPlay={false} className="media-preview-video" />
      </div>
    </div>,
    document.body,
  );
}

export function QrImage({ value }: { value: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    void import("qrcode").then((mod) =>
      mod.toDataURL(value, {
        margin: 1,
        width: 280,
        color: { dark: "#1c1412", light: "#fffdfb" },
      }),
    ).then((next) => {
      if (!cancel) setUrl(next);
    });
    return () => {
      cancel = true;
    };
  }, [value]);

  return (
    <div className="grid size-52 place-items-center rounded-2xl border border-line bg-card">
      {url ? <img src={url} alt="QR code for this wedding" className="size-48" /> : <span className="text-sm text-muted">Preparing the code</span>}
    </div>
  );
}

export function HoldTarget({
  label,
  actions,
  children,
  className,
}: {
  label: string;
  actions: { id: string; label: string; onSelect: () => void }[];
  children: ReactNode;
  className?: string;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef(0);
  const point = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const cancelHold = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    let swallow = false;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (root.current?.contains(target) || menuRef.current?.contains(target))) return;
      swallow = true;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const onClick = (event: MouseEvent) => {
      if (!swallow) return;
      swallow = false;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("click", onClick, true);
    };
  }, [menu]);

  useEffect(() => () => {
    window.clearTimeout(timer.current);
    cancelHold.current?.();
  }, []);

  if (actions.length === 0) {
    if (!className) return <>{children}</>;
    return <div className={className}>{children}</div>;
  }

  function openAt(x: number, y: number) {
    const width = 196;
    const height = (actions.length + 1) * 44 + 12;
    setMenu({
      x: Math.min(window.innerWidth - width - 8, Math.max(8, x)),
      y: Math.min(window.innerHeight - height - 8, Math.max(8, y - 8)),
    });
  }

  function arm(x: number, y: number) {
    cancelHold.current?.();
    const cancel = () => {
      window.clearTimeout(timer.current);
      point.current = null;
      window.removeEventListener("scroll", cancel, true);
      if (cancelHold.current === cancel) cancelHold.current = null;
    };
    cancelHold.current = cancel;
    window.addEventListener("scroll", cancel, true);
    timer.current = window.setTimeout(() => {
      cancel();
      if (window.getSelection()?.toString()) return;
      held.current = true;
      openAt(x, y);
    }, 1000);
  }

  return (
    <div
      ref={root}
      className={className}
      tabIndex={0}
      aria-label={label}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.pointerType === "mouse" && event.button !== 0) return;
        point.current = { x: event.clientX, y: event.clientY };
        held.current = false;
        arm(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        const origin = point.current;
        if (!origin) return;
        if (Math.abs(event.clientX - origin.x) > 12 || Math.abs(event.clientY - origin.y) > 12) {
          cancelHold.current?.();
        }
      }}
      onPointerUp={() => {
        cancelHold.current?.();
      }}
      onPointerCancel={() => {
        cancelHold.current?.();
      }}
      onClickCapture={(event) => {
        if (!held.current) return;
        held.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openAt(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const box = root.current?.getBoundingClientRect();
          openAt(box?.left ?? 16, box?.bottom ?? 24);
        }
        if (event.key === "Escape") setMenu(null);
      }}
    >
      {children}
      {menu
        ? createPortal(
            <div ref={menuRef} className="hold-menu" style={{ left: menu.x, top: menu.y }} role="menu" aria-label={label}>
              <div className="flex items-center justify-end border-b border-line">
                <button type="button" className="inline-flex size-11 items-center justify-center text-ink" aria-label="Close" onClick={() => setMenu(null)}>
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  className={`block min-h-11 w-full px-4 text-left text-sm ${action.id === "delete" ? "hold-delete font-medium" : "text-ink"}`}
                  onClick={() => {
                    setMenu(null);
                    held.current = false;
                    action.onSelect();
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
