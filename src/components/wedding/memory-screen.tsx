import { useEffect, useMemo, useState } from "react";
import { useWedding } from "@/components/wedding/context";
import { Button, Empty, MediaGroupView, Photo, Screen } from "@/components/wedding/ui";
import { downloadStored } from "@/lib/wedding/media-db";
import { weddingDownloadName } from "@/lib/wedding/download-name";
import { canDownload, coupleTitle } from "@/lib/wedding/format";
import { canView } from "@/lib/wedding/access";
import { useWeddingStore } from "@/lib/wedding/store";

const openAlbum = new Map<string, { src: string; caption: string }>();

export function MemoriesScreen() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const download = canDownload(wedding, viewer.role);
  const [open, setOpen] = useState<{ src: string; caption: string } | null>(() => openAlbum.get(wedding.id) ?? null);
  const groups = useMemo(() => groupMemories(wedding), [wedding]);
  const frames = useMemo(
    () => groups.flatMap((group) => group.items.map((item) => ({ kind: "image" as const, src: item.src, caption: item.caption }))),
    [groups],
  );
  const total = frames.length;
  useEffect(() => {
    if (open) openAlbum.set(wedding.id, open);
    else openAlbum.delete(wedding.id);
  }, [open, wedding.id]);

  return (
    <div className="album-stage mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 py-4 md:px-8 md:py-6 lg:max-w-5xl">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h1 className="album-heading font-serif text-3xl md:text-4xl">Album</h1>
        {total > 0 ? (
          <p className="album-heading text-sm tabular-nums">
            {total} {total === 1 ? "photo" : "photos"}
          </p>
        ) : null}
      </div>
      {!download ? (
        <p className="mb-4 text-sm text-muted">The family has turned downloads off for guests.</p>
      ) : null}
      {groups.length === 0 ? (
        <div className="album-empty flex min-h-0 flex-1 flex-col">
          <Empty title="No photographs yet" text="When guests share, they land here under the function they chose." />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.id}>
              {group.id === "loose" ? null : (
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="album-heading font-serif text-2xl">{group.name}</h2>
                  <p className="album-heading text-sm tabular-nums">
                    {group.items.length} {group.items.length === 1 ? "photo" : "photos"}
                  </p>
                </div>
              )}
              <div className="album-grid grid grid-cols-2 gap-2 md:grid-cols-3">
                {group.items.map((item, index) => (
                  <figure key={item.src + item.caption} className="overflow-hidden rounded-2xl bg-paper">
                    <div
                      role="button"
                      tabIndex={0}
                      className="album-shot block w-full"
                      onPointerDown={(event) => {
                        event.currentTarget.dataset.x = String(event.clientX);
                        event.currentTarget.dataset.y = String(event.clientY);
                      }}
                      onClick={(event) => {
                        const x = Number(event.currentTarget.dataset.x || event.clientX);
                        const y = Number(event.currentTarget.dataset.y || event.clientY);
                        if (Math.abs(event.clientX - x) > 10 || Math.abs(event.clientY - y) > 10) return;
                        setOpen(item);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setOpen(item);
                        }
                      }}
                    >
                      <Photo src={item.src} alt={item.caption} preview className="aspect-[4/3] w-full object-cover" />
                    </div>
                    <figcaption className="flex items-start justify-between gap-2 px-2 py-2 text-xs text-muted">
                      <span>{item.caption}</span>
                      {download ? (
                        <button type="button" className="shrink-0 text-maroon" onClick={() => void downloadStored(item.src, weddingDownloadName(item.src, index + 1))}>
                          Save
                        </button>
                      ) : null}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {open ? (
        <MediaGroupView
          tiles={frames}
          start={Math.max(0, frames.findIndex((frame) => frame.src === open.src && frame.caption === open.caption))}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

export function HighlightsScreen() {
  const wedding = useWedding();
  const frames = useMemo(() => groupMemories(wedding).flatMap((g) => g.items), [wedding]);
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    if (index === null) return;
    if (index >= frames.length) return;
    const id = window.setTimeout(() => setIndex(index + 1), 2800);
    return () => window.clearTimeout(id);
  }, [index, frames.length]);

  const frame = index !== null ? frames[index] : undefined;

  return (
    <Screen
      title="Highlights"
      lede="A first pass through the day, in the order the functions happened. A later cut can drop repeats and score a film. This one just plays what the circle already shared."
    >
      {frames.length === 0 ? (
        <Empty title="Nothing to arrange yet" text="Share a few photographs and the reel has somewhere to start." />
      ) : index === null || index >= frames.length ? (
        <div className="rounded-card border border-line bg-card p-6">
          <p className="font-serif text-3xl">{index !== null && index >= frames.length ? coupleTitle(wedding) : "Your wedding, in order"}</p>
          <p className="mt-2 text-muted">
            {index !== null && index >= frames.length
              ? `${longEnough(frames.length)} moments, kept. The circle does not disappear when the lights do.`
              : `${frames.length} photographs are ready.`}
          </p>
          <Button className="mt-5" onClick={() => setIndex(0)}>
            {index !== null ? "Play it again" : "Play the day"}
          </Button>
        </div>
      ) : frame ? (
        <div className="overflow-hidden rounded-card bg-ink">
          <Photo src={frame.src} alt="" className="aspect-[4/3] w-full object-cover md:aspect-video" />
          <div className="flex items-end justify-between gap-4 p-4 text-on-photo">
            <div>
              <p className="text-sm opacity-80">{frame.group}</p>
              <p className="font-serif text-2xl">{frame.caption}</p>
            </div>
            <p className="text-sm tabular-nums">
              {index + 1}/{frames.length}
            </p>
          </div>
        </div>
      ) : null}
    </Screen>
  );
}

function longEnough(n: number) {
  return n === 1 ? "One moment" : `${n} moments`;
}

function groupMemories(wedding: ReturnType<typeof useWedding>) {
  const viewer = useWeddingStore.getState().viewer;
  const groups = wedding.functions.filter((item) => canView(wedding, viewer, item.accessRule, item.id)).map((f) => ({
    id: f.id,
    name: f.name,
    items: [] as { src: string; caption: string; group: string }[],
  }));
  const loose = { id: "loose", name: "The rest of the day", items: [] as { src: string; caption: string; group: string }[] };
  for (const post of [...wedding.posts].reverse()) {
    if (!canView(wedding, viewer, post.accessRule, post.id, post.author)) continue;
    for (const src of post.images) {
      const item = { src, caption: post.text, group: "" };
      const group = groups.find((g) => g.id === post.functionId);
      if (group) {
        item.group = group.name;
        group.items.push(item);
      } else {
        item.group = loose.name;
        loose.items.push(item);
      }
    }
  }
  return [...groups, loose].filter((g) => g.items.length > 0);
}
