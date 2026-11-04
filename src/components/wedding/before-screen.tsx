import { useState } from "react";
import { toast } from "sonner";
import { PersonName } from "@/components/wedding/marks";
import { useWedding } from "@/components/wedding/context";
import { MediaGrid, MediaUploadGrid } from "@/components/wedding/media-grid";
import { Button, fieldClass, PickList } from "@/components/wedding/ui";
import { canContribute, canDownload, canManage, sideTitle } from "@/lib/wedding/format";
import { useWeddingStore } from "@/lib/wedding/store";
import { MAX_PHOTOS, MAX_VIDEOS, PHOTO_ACCEPT, VIDEO_ACCEPT, mediaKindOf, prepareMany, prepareUpload, uploadProgressPercent } from "@/lib/wedding/media";
import { downloadStored } from "@/lib/wedding/media-db";
import { weddingDownloadName } from "@/lib/wedding/download-name";
import { ownPickerFiles } from "@/lib/wedding/picker-file";
import type { BeforeKind } from "@/lib/wedding/types";

type PendingMedia = {
  id: string;
  file: File;
  preview: string;
  kind: "image" | "video";
  status: "processing" | "uploading" | "uploaded" | "failed" | "selected" | "cancelled";
  progress: number | null;
  error: string;
};

export function BeforeScreen() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const addBefore = useWeddingStore((s) => s.addBefore);
  const removeBefore = useWeddingStore((s) => s.removeBefore);
  const shareBeforeHome = useWeddingStore((s) => s.shareBeforeHome);
  const allowed = canContribute(wedding, viewer);
  const notes = (wedding.beforeNotes ?? []).filter((item) => item.kind !== "video");
  const videos = (wedding.beforeNotes ?? []).filter((item) => item.kind === "video");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Exclude<BeforeKind, "video">>("note");
  const [images, setImages] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [photoItems, setPhotoItems] = useState<PendingMedia[]>([]);
  const [videoItems, setVideoItems] = useState<PendingMedia[]>([]);
  const [photoNote, setPhotoNote] = useState("");
  const [videoNote, setVideoNote] = useState("");

  function paint(setItems: typeof setPhotoItems, id: string, label: string) {
    const percent = uploadProgressPercent(label);
    setItems((current) => current.map((item) => item.id === id ? {
      ...item,
      status: percent != null && percent > 0 ? "uploading" : "processing",
      progress: percent != null && percent > 0 ? percent : null,
    } : item));
  }

  async function onPhotos(chosen: File[]) {
    if (chosen.length === 0 || photoBusy) return;
    const drafts = chosen.filter((file) => mediaKindOf(file) === "image").map((file) => ({
      id: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
      kind: "image" as const,
      status: "processing" as const,
      progress: null,
      error: "",
    }));
    if (!drafts.length) {
      setPhotoNote("Choose a photo for this column.");
      return;
    }
    setPhotoItems((current) => [...current, ...drafts]);
    setPhotoBusy(true);
    setPhotoNote("");
    try {
      const batch = await prepareMany(drafts.map((item) => item.file), () => undefined, wedding.slug, (index, label) => {
        const id = drafts[index]?.id;
        if (id) paint(setPhotoItems, id, label);
      });
      if (batch.limited) toast(`Up to ${MAX_PHOTOS} photos and ${MAX_VIDEOS} videos at once.`);
      const saved: string[] = [];
      const failed: PendingMedia[] = [];
      drafts.forEach((draft, index) => {
        const outcome = batch.outcomes[index];
        if (outcome?.ok && outcome.item.kind === "image") {
          saved.push(outcome.item.src);
          URL.revokeObjectURL(draft.preview);
          return;
        }
        failed.push({
          ...draft,
          status: "failed",
          progress: null,
          error: outcome && !outcome.ok ? outcome.error : "That photo could not be saved.",
        });
      });
      if (saved.length) setImages((prev) => [...prev, ...saved].slice(0, MAX_PHOTOS));
      setPhotoItems((current) => [...current.filter((item) => !drafts.some((draft) => draft.id === item.id)), ...failed]);
      if (failed[0]) {
        setPhotoNote(failed[0].error);
        toast(failed[0].error);
      }
    } finally {
      setPhotoBusy(false);
    }
  }

  async function retryPhoto(id: string) {
    const draft = photoItems.find((item) => item.id === id);
    if (!draft || draft.status === "uploading" || draft.status === "processing") return;
    setPhotoItems((current) => current.map((item) => item.id === id ? { ...item, status: "processing", error: "", progress: null } : item));
    try {
      const media = await prepareUpload(draft.file, (label) => paint(setPhotoItems, id, label), wedding.slug);
      if (media.kind !== "image") throw new Error("Choose a photo for this column.");
      URL.revokeObjectURL(draft.preview);
      setImages((prev) => [...prev, media.src].slice(0, MAX_PHOTOS));
      setPhotoItems((current) => current.filter((item) => item.id !== id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "That photo could not be saved.";
      setPhotoItems((current) => current.map((item) => item.id === id ? { ...item, status: "failed", progress: null, error: message } : item));
      toast(message);
    }
  }

  async function onVideos(chosen: File[]) {
    if (chosen.length === 0 || videoBusy) return;
    const drafts = chosen.filter((file) => mediaKindOf(file) === "video").map((file) => ({
      id: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
      kind: "video" as const,
      status: "processing" as const,
      progress: null,
      error: "",
    }));
    if (!drafts.length) {
      setVideoNote("Choose a video for this column.");
      return;
    }
    setVideoItems((current) => [...current, ...drafts]);
    setVideoBusy(true);
    setVideoNote("");
    try {
      const batch = await prepareMany(drafts.map((item) => item.file), () => undefined, wedding.slug, (index, label) => {
        const id = drafts[index]?.id;
        if (id) paint(setVideoItems, id, label);
      });
      if (batch.limited) toast(`Up to ${MAX_PHOTOS} photos and ${MAX_VIDEOS} videos at once.`);
      const failed: PendingMedia[] = [];
      let posted = 0;
      drafts.forEach((draft, index) => {
        const outcome = batch.outcomes[index];
        if (outcome?.ok && outcome.item.kind === "video") {
          posted += 1;
          addBefore(wedding.id, {
            author: viewer.name,
            text: text.trim() || "A pre-wedding video.",
            images: [],
            kind: "video",
            video: outcome.item.src,
            videoSeconds: outcome.item.seconds,
            side: viewer.side,
          });
          URL.revokeObjectURL(draft.preview);
          return;
        }
        failed.push({
          ...draft,
          status: "failed",
          progress: null,
          error: outcome && !outcome.ok ? outcome.error : "That video could not be saved.",
        });
      });
      if (posted) setText("");
      setVideoItems((current) => [...current.filter((item) => !drafts.some((draft) => draft.id === item.id)), ...failed]);
      if (failed[0]) {
        setVideoNote(failed[0].error);
        toast(failed[0].error);
      }
    } finally {
      setVideoBusy(false);
    }
  }

  async function retryVideo(id: string) {
    const draft = videoItems.find((item) => item.id === id);
    if (!draft || draft.status === "uploading" || draft.status === "processing") return;
    setVideoItems((current) => current.map((item) => item.id === id ? { ...item, status: "processing", error: "", progress: null } : item));
    try {
      const media = await prepareUpload(draft.file, (label) => paint(setVideoItems, id, label), wedding.slug);
      if (media.kind !== "video") throw new Error("Choose a video for this column.");
      addBefore(wedding.id, {
        author: viewer.name,
        text: text.trim() || "A pre-wedding video.",
        images: [],
        kind: "video",
        video: media.src,
        videoSeconds: media.seconds,
        side: viewer.side,
      });
      URL.revokeObjectURL(draft.preview);
      setText("");
      setVideoItems((current) => current.filter((item) => item.id !== id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "That video could not be saved.";
      setVideoItems((current) => current.map((item) => item.id === id ? { ...item, status: "failed", progress: null, error: message } : item));
      toast(message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6">
        <h1 className="font-serif text-3xl md:text-4xl">Pre-wedding</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Before the functions begin. Share a note, an outfit, or anything else the families should see. Videos stay in their own column.
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)]">
        <section>
          <h2 className="font-serif text-2xl">Notes and outfits</h2>
          {allowed ? (
            <form
              className="mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (photoBusy) return;
                if (!text.trim() && images.length === 0) {
                  setPhotoNote("Add a note or a photo, then press Share.");
                  return;
                }
                addBefore(wedding.id, {
                  author: viewer.name,
                  text: text.trim() || (kind === "outfit" ? "An outfit." : "A note."),
                  images,
                  kind,
                  side: viewer.side,
                });
                setText("");
                setImages([]);
                setPhotoNote("");
                toast("Shared before the wedding.");
              }}
            >
              <textarea className={fieldClass} rows={3} placeholder="A fitting, a song, who is travelling in…" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="mt-2 grid gap-2">
                <PickList
                  label="Kind"
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: "note", label: "Info" },
                    { value: "outfit", label: "Outfit" },
                    { value: "other", label: "Other" },
                  ]}
                />
                <div className="flex flex-wrap gap-2">
                <label className={`inline-flex min-h-11 items-center rounded-full border border-line bg-card px-4 text-sm ${photoBusy ? "pointer-events-none opacity-80" : "cursor-pointer"}`}>
                  {photoBusy ? "Adding…" : "Gallery"}
                  <input
                    type="file"
                    multiple
                    accept={PHOTO_ACCEPT}
                    className="sr-only"
                    disabled={photoBusy}
                    onChange={(e) => {
                      const input = e.target;
                      const chosen = Array.from(input.files ?? []);
                      if (!chosen.length) return;
                      void ownPickerFiles(chosen).then((owned) => {
                        input.value = "";
                        if (owned.errors[0]) {
                          setPhotoNote(owned.errors[0]);
                          toast(owned.errors[0]);
                        }
                        if (owned.files.length) void onPhotos(owned.files);
                      });
                    }}
                  />
                </label>
                <Button type="submit" disabled={photoBusy}>Share</Button>
                </div>
              </div>
              {photoBusy ? null : <p className="mt-2 text-sm text-muted">Up to 50 photos at once.</p>}
              {photoNote && !photoBusy ? <p className="mt-2 text-sm text-maroon">{photoNote}</p> : null}
              {photoItems.length > 0 ? (
                <div className="mt-3">
                  <MediaUploadGrid
                    items={photoItems.map((item) => ({ id: item.id, kind: item.kind, src: item.preview, status: item.status, progress: item.progress, error: item.error }))}
                    onRetry={(id) => void retryPhoto(id)}
                    onCancel={() => undefined}
                  />
                </div>
              ) : null}
              {images.length > 0 ? (
                <div className="mt-3">
                  <MediaGrid mine tiles={images.map((src) => ({ kind: "image" as const, src }))} />
                </div>
              ) : null}
            </form>
          ) : (
            <p className="mt-2 text-sm text-muted">You can read this room. Posting here is for the host, co-hosts, and family.</p>
          )}
          <ul className="mt-4 flex flex-col gap-3">
            {notes.length === 0 ? <li className="text-sm text-muted">Nothing shared yet.</li> : null}
            {notes.map((item) => (
              <li key={item.id} className="rounded-card border border-line bg-card p-4">
                <p>
                  <PersonName wedding={wedding} name={item.author} />
                  {sideTitle(item.side) ? <span className="ml-2 font-bold">{sideTitle(item.side)}</span> : null}
                  <span className="ml-2 text-sm text-muted">{item.kind === "outfit" ? "Outfit" : item.kind === "other" ? "Other" : "Info"}</span>
                </p>
                {item.text ? <p className="mt-2 text-lg">{item.text}</p> : null}
                {item.images.length > 0 ? (
                  <div className="mt-3">
                    <MediaGrid mine={item.author === viewer.name} tiles={item.images.map((src) => ({ kind: "image" as const, src }))} />
                  </div>
                ) : null}
                <p className="mt-3 text-sm text-muted">{item.atLabel}</p>
                {item.author === viewer.name || allowed ? (
                  <button
                    type="button"
                    className="mt-2 min-h-11 text-sm text-muted"
                    onClick={() => {
                      const sources = [...item.images, item.video || ""].filter((src) => src.startsWith("gp:") || src.startsWith("r2:"));
                      const legacy = sources.some((src) => src.startsWith("gp:"));
                      if (sources.length && !window.confirm(legacy ? "Remove this from the circle? Files already in Google Drive stay there and are not deleted." : "Remove this from the circle? The file is not deleted from private storage.")) return;
                      removeBefore(wedding.id, item.id);
                    }}
                  >
                    Delete
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-card border border-line bg-paper p-4">
          <h2 className="font-serif text-2xl">Pre-wedding videos</h2>
          <p className="mt-1 text-sm text-muted">Only videos. Photos and notes stay in the other column.</p>
          {allowed ? (
            <label className={`mt-3 inline-flex min-h-11 items-center rounded-full border border-line bg-card px-4 text-sm ${videoBusy ? "pointer-events-none opacity-80" : "cursor-pointer"}`}>
              {videoBusy ? "Adding…" : "Add a video"}
              <input
                type="file"
                multiple
                accept={VIDEO_ACCEPT}
                className="sr-only"
                disabled={videoBusy}
                onChange={(e) => {
                  const input = e.target;
                  const chosen = Array.from(input.files ?? []);
                  if (!chosen.length) return;
                  void ownPickerFiles(chosen).then((owned) => {
                    input.value = "";
                    if (owned.errors[0]) {
                      setVideoNote(owned.errors[0]);
                      toast(owned.errors[0]);
                    }
                    if (owned.files.length) void onVideos(owned.files);
                  });
                }}
              />
            </label>
          ) : null}
          {allowed && !videoBusy ? <p className="mt-2 text-sm text-muted">Up to 5 videos at once.</p> : null}
          {videoNote && !videoBusy ? <p className="mt-2 text-sm text-maroon">{videoNote}</p> : null}
          {videoItems.length > 0 ? (
            <div className="mt-3">
              <MediaUploadGrid
                items={videoItems.map((item) => ({ id: item.id, kind: item.kind, src: item.preview, status: item.status, progress: item.progress, error: item.error }))}
                onRetry={(id) => void retryVideo(id)}
                onCancel={() => undefined}
              />
            </div>
          ) : null}
          <ul className="mt-4 flex flex-col gap-3">
            {videos.length === 0 ? <li className="text-sm text-muted">No videos yet.</li> : null}
            {videos.map((item) => (
              <li key={item.id} className="overflow-hidden rounded-2xl border border-line bg-card">
                {item.video ? <MediaGrid mine={item.author === viewer.name} tiles={[{ kind: "video", src: item.video }]} /> : null}
                <div className="p-3">
                  <p>
                    <PersonName wedding={wedding} name={item.author} />
                  </p>
                  {item.text ? <p className="mt-1 text-sm">{item.text}</p> : null}
                  <p className="mt-1 text-sm text-muted">{item.atLabel}{item.videoSeconds ? ` · ${item.videoSeconds}s` : ""}</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {item.video && (item.author === viewer.name || canManage(wedding, viewer)) ? (
                      <button
                        type="button"
                        className="min-h-11 text-sm text-maroon"
                        onClick={() => {
                          shareBeforeHome(wedding.id, item.id);
                          toast(item.onHome ? "Removed from the home page." : "On the home page, in Pre-wedding.");
                        }}
                      >
                        {item.onHome ? "On home" : "Share on home"}
                      </button>
                    ) : null}
                    {item.video && canDownload(wedding, viewer.role) ? (
                      <button type="button" className="min-h-11 text-sm text-maroon" onClick={() => void downloadStored(item.video || "", weddingDownloadName(item.video || "", 1))}>
                        Download
                      </button>
                    ) : null}
                    {item.author === viewer.name || allowed ? (
                      <button
                        type="button"
                        className="min-h-11 text-sm text-muted"
                        onClick={() => {
                          const sources = [item.video || ""].filter((src) => src.startsWith("gp:") || src.startsWith("r2:"));
                          const legacy = sources.some((src) => src.startsWith("gp:"));
                          if (sources.length && !window.confirm(legacy ? "Remove this from the circle? Files already in Google Drive stay there and are not deleted." : "Remove this from the circle? The file is not deleted from private storage.")) return;
                          removeBefore(wedding.id, item.id);
                        }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
