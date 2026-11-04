import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { WeddingCard } from "@/components/wedding/wedding-card";
import { Button } from "@/components/wedding/ui";
import { compressImage } from "@/lib/wedding/format";
import { PHOTO_ACCEPT } from "@/lib/wedding/media";
import { resolveLibrarySrc, useLibrary } from "@/lib/wedding/library";
import { BUILTIN_ASSETS } from "@/lib/wedding/library-catalog";
import { useWeddingStore } from "@/lib/wedding/store";
import type { CoverFrame, WeddingBarLayout } from "@/lib/wedding/bar-layout";
import { frameForTheme, parkLegacyFrame } from "@/lib/wedding/bar-layout";
import type { Wedding } from "@/lib/wedding/types";

const COVERS = [
  { id: "pastel-garden", label: "Pastel floral garden", src: "/covers/pastel-garden.svg" },
  { id: "ivory-gold", label: "Ivory and champagne gold", src: "/covers/ivory-gold.svg" },
  { id: "dusty-rose", label: "Dusty rose flowers", src: "/covers/dusty-rose.svg" },
  { id: "maroon-gold", label: "Elegant maroon and gold", src: "/covers/maroon-gold.svg" },
  { id: "sage", label: "Sage green botanical", src: "/covers/sage.svg" },
  { id: "royal", label: "Royal Indian motifs", src: "/covers/royal.svg" },
] as const;

const START_FRAME: CoverFrame = { x: 50, y: 50, zoom: 1 };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
}

function writeThemeFrame(current: WeddingBarLayout, themeId: string, frame: CoverFrame | undefined): WeddingBarLayout {
  const frames = { ...(current.frames ?? {}) };
  if (frame) frames[themeId] = frame;
  else delete frames[themeId];
  const next: WeddingBarLayout = { ...current };
  delete next.frame;
  if (Object.keys(frames).length) next.frames = frames;
  else delete next.frames;
  return next;
}

export function WeddingBarPanel({ wedding }: { wedding: Wedding }) {
  const setWeddingBar = useWeddingStore((s) => s.setWeddingBar);
  const library = useLibrary();
  const saved = wedding.bar;
  const themeId = wedding.cardTheme || "classic-default";
  const [draft, setDraft] = useState<WeddingBarLayout>(() => parkLegacyFrame(saved, themeId) ?? {});
  const [uploading, setUploading] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setDraft(parkLegacyFrame(saved, themeId) ?? {});
  }, [saved, themeId]);
  const catalog = (library.ready && !library.failed ? library.assets : BUILTIN_ASSETS.map((item) => ({ ...item, active: true })))
    .filter((item) => item.active && item.category === "Wedding covers");
  const activeFrame = frameForTheme(draft, themeId, themeId);

  function onCoverPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const base = activeFrame ?? START_FRAME;
    const startX = event.clientX;
    const startY = event.clientY;
    const placeAt = (clientX: number, clientY: number) => {
      const dx = ((clientX - startX) / box.width) * 100;
      const dy = ((clientY - startY) / box.height) * 100;
      setDraft((current) => writeThemeFrame(current, themeId, {
        x: clamp(base.x - dx, 0, 100),
        y: clamp(base.y - dy, 0, 100),
        zoom: frameForTheme(current, themeId, themeId)?.zoom ?? base.zoom,
      }));
    };
    const onMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      placeAt(moveEvent.clientX, moveEvent.clientY);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function save() {
    const result = setWeddingBar(wedding.id, parkLegacyFrame(draft, themeId) ?? draft);
    toast(result === "ok" ? "Wedding bar saved." : "Only a host or co-host can change the wedding bar.");
  }

  const zoom = activeFrame?.zoom ?? 1;
  const preview = { ...wedding, bar: draft };

  return (
    <div className="wedding-bar-editor">
      <p className="text-sm text-muted">Drag the cover to frame it, then zoom if you need a closer crop. Names, the date, and the place stay where they are.</p>
      <div className="relative mt-3 touch-none" ref={frame}>
        <WeddingCard wedding={preview} preview />
        <div
          className="bar-cover-pan"
          role="application"
          aria-label="Drag the cover photo. Names, date, and place stay fixed."
          onPointerDown={onCoverPointerDown}
        />
      </div>
      <label className="mt-3 block text-sm">
        Zoom {zoom.toFixed(1)}×
        <input
          className="mt-1 block w-full"
          type="range"
          min={1}
          max={3}
          step={0.1}
          value={zoom}
          aria-label="Cover zoom"
          onChange={(event) => {
            const next = Number(event.target.value);
            setDraft((current) => {
              const live = frameForTheme(current, themeId, themeId) ?? START_FRAME;
              return writeThemeFrame(current, themeId, {
                x: live.x,
                y: live.y,
                zoom: clamp(next, 1, 3),
              });
            });
          }}
        />
      </label>
      <button
        type="button"
        className="mt-2 min-h-11 text-sm text-maroon"
        onClick={() => setDraft((current) => writeThemeFrame(current, themeId, undefined))}
      >
        Reset cover framing
      </button>

      <h3 className="mt-4 font-medium">Cover photo</h3>
      <ul className="mt-2 grid grid-cols-3 gap-2">
        {COVERS.map((cover) => (
          <li key={cover.id}>
            <button type="button" className={draft.cover === cover.src ? "bar-cover is-on" : "bar-cover"} aria-pressed={draft.cover === cover.src} onClick={() => setDraft((current) => ({ ...current, cover: cover.src }))}>
              <img src={cover.src} alt="" />
              <span>{cover.label}</span>
            </button>
          </li>
        ))}
        {catalog.map((cover) => (
          <li key={cover.id}>
            <button type="button" className={draft.cover === cover.path ? "bar-cover is-on" : "bar-cover"} aria-pressed={draft.cover === cover.path} onClick={() => setDraft((current) => ({ ...current, cover: cover.path }))}>
              <img src={resolveLibrarySrc(cover.path, library.assets)} alt="" />
              <span>{cover.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center text-sm text-maroon">
        {uploading ? "Preparing photo…" : "Upload a cover photo"}
        <input
          type="file"
          accept={PHOTO_ACCEPT}
          className="sr-only"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setUploading(true);
            void compressImage(file)
              .then((src) => setDraft((current) => ({ ...current, cover: src })))
              .catch(() => toast("That photo could not be used."))
              .finally(() => setUploading(false));
          }}
        />
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" disabled={uploading} onClick={save}>Save</Button>
        <Button type="button" variant="line" onClick={() => setDraft(saved ?? {})}>Cancel</Button>
      </div>
    </div>
  );
}
