import { useState, type ReactNode } from "react";
import { MediaGroupView, Photo, useMediaUrl } from "@/components/wedding/ui";
import { mediaGridPlan } from "@/lib/wedding/media-grid";

export type GridMedia = { kind: "image" | "video"; src: string };

function VideoPoster({ src }: { src: string }) {
  const remote = useMediaUrl(src, "preview");
  if (!remote.url) return <span className="media-tile-fill is-wait" aria-busy={remote.note ? undefined : true} aria-label={remote.note || "Loading"} />;
  return <img src={remote.url} alt="" className="media-tile-fill" loading="lazy" decoding="async" />;
}

function TileFace({ kind, src }: GridMedia) {
  const local = src.startsWith("blob:") || src.startsWith("data:");
  if (local && kind === "video") return <video src={src} className="media-tile-fill" muted playsInline preload="metadata" />;
  if (local) return <img src={src} alt="" className="media-tile-fill" loading="lazy" decoding="async" />;
  if (kind === "video") return <VideoPoster src={src} />;
  return <Photo src={src} alt="" preview className="media-tile-fill" />;
}

function GridShell({
  tiles,
  mine,
  extraOn,
  renderExtra,
  overlays,
  onOpen,
}: {
  tiles: GridMedia[];
  mine: boolean;
  extraOn: boolean;
  renderExtra?: (index: number) => ReactNode;
  overlays?: (index: number) => ReactNode;
  onOpen: (index: number) => void;
}) {
  const plan = mediaGridPlan(tiles.length);
  const shown = tiles.slice(0, plan.cells);
  return (
    <div className={`media-grid is-${plan.mode}${mine ? " is-mine" : ""}`} role="group" aria-label={`${tiles.length} ${tiles.length === 1 ? "file" : "files"}`}>
      {shown.map((tile, index) => {
        const more = extraOn && plan.extra > 0 && index === shown.length - 1;
        return (
          <div
            key={`${tile.kind}-${index}-${tile.src.slice(0, 24)}`}
            role="button"
            tabIndex={0}
            className="media-tile"
            aria-label={more ? `Show ${plan.extra} more` : tile.kind === "video" ? "Play video" : "View photo"}
            onClick={() => onOpen(index)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onOpen(index);
            }}
          >
            <TileFace kind={tile.kind} src={tile.src} />
            {tile.kind === "video" && !more ? <span className="media-tile-play" aria-hidden="true">▶</span> : null}
            {overlays?.(index)}
            {more ? <span className="media-more">+{plan.extra}</span> : null}
            {renderExtra?.(index)}
          </div>
        );
      })}
    </div>
  );
}

export function MediaGrid({ tiles, mine = false }: { tiles: GridMedia[]; mine?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!tiles.length) return null;
  return (
    <>
      <GridShell tiles={tiles} mine={mine} extraOn onOpen={setOpen} />
      {open !== null ? <MediaGroupView tiles={tiles} start={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

export type UploadGridItem = {
  id: string;
  kind: "image" | "video";
  src: string;
  status: "selected" | "processing" | "uploading" | "uploaded" | "failed" | "cancelled";
  progress: number | null;
  error: string;
};

export function MediaUploadGrid({
  items,
  mine = true,
  onRetry,
  onCancel,
}: {
  items: UploadGridItem[];
  mine?: boolean;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const live = items.filter((item) => item.status !== "cancelled" && item.src);
  if (!live.length) return null;
  const plan = mediaGridPlan(live.length);
  const hiddenFailed = live.slice(plan.cells);
  return (
    <>
      <GridShell
        tiles={live.map((item) => ({ kind: item.kind, src: item.src }))}
        mine={mine}
        extraOn={live.every((item) => item.status === "uploaded")}
        onOpen={setOpen}
        overlays={(index) => {
          const item = live[index];
          if (!item || item.status === "uploaded" && live.every((entry) => entry.status === "uploaded")) return null;
          if (item.status === "uploaded") return <span className="media-shade is-ok" aria-label="Uploaded">✓</span>;
          if (item.status === "failed") {
            return (
              <span className="media-shade">
                <span>Failed</span>
                <button type="button" className="media-tile-action" onClick={(event) => { event.stopPropagation(); onRetry(item.id); }}>Retry</button>
              </span>
            );
          }
          if (item.status === "selected") {
            return (
              <span className="media-shade">
                <button type="button" className="media-tile-action" onClick={(event) => { event.stopPropagation(); onCancel(item.id); }}>Cancel</button>
              </span>
            );
          }
          if (item.status === "processing" || item.progress == null || item.progress <= 0) {
            return (
              <span className="media-shade">
                <span className="media-spin" aria-hidden="true" />
                <span>{item.status === "processing" ? "Preparing" : "Uploading"}</span>
              </span>
            );
          }
          return (
            <span className="media-shade" aria-label={`Uploading ${item.progress}%`}>
              <span className="media-pct">{item.progress}%</span>
            </span>
          );
        }}
        renderExtra={(index) => {
          if (plan.extra <= 0 || index !== plan.cells - 1 || live.every((item) => item.status === "uploaded")) return null;
          return <span className="media-more is-badge">+{plan.extra}</span>;
        }}
      />
      {hiddenFailed.some((item) => item.status === "failed") ? (
        <div className="media-grid-notes">
          {hiddenFailed.filter((item) => item.status === "failed").map((item) => (
            <p key={item.id} className="media-grid-error" role="status">
              <span>{item.error || "That file could not be uploaded."}</span>
              <button type="button" onClick={() => onRetry(item.id)}>Retry</button>
            </p>
          ))}
        </div>
      ) : null}
      {open !== null ? <MediaGroupView tiles={live.map((item) => ({ kind: item.kind, src: item.src }))} start={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
