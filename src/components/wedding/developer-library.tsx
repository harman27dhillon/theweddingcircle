import { useEffect, useState, type FormEvent } from "react";
import {
  developerLibraryActive,
  developerLibraryCreate,
  developerLibraryDelete,
  developerLibraryList,
  developerLibraryRename,
  developerLibraryReplace,
  developerSampleCoverClear,
  developerSampleCoverSave,
} from "@/lib/wedding/library.functions";
import { LIBRARY_CATEGORIES } from "@/lib/wedding/library-catalog";
import { invalidateLibrary, visibleCover } from "@/lib/wedding/library";
import { compressImage } from "@/lib/wedding/format";
import { PHOTO_ACCEPT, mediaKindOf } from "@/lib/wedding/media";
import { developerPublicConfig } from "@/lib/developer/console.functions";
import { LibraryPhoto } from "@/components/wedding/library-photo";

type LibraryBody = Awaited<ReturnType<typeof developerLibraryList>>;
type Asset = Extract<LibraryBody, { ok: true }>["assets"][number];

const ACCEPT = PHOTO_ACCEPT;

function preparePicture(file: File, onProgress: (percent: number) => void) {
  if (mediaKindOf(file) !== "image") return Promise.reject(new Error("type"));
  if (file.size > 12 * 1024 * 1024) return Promise.reject(new Error("size"));
  return compressImage(file, onProgress).then((dataUrl) => {
    const data = dataUrl.split(",")[1] || "";
    const mime = dataUrl.startsWith("data:image/png") ? "image/png" : dataUrl.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
    if (data.length < 32 || data.length > 900_000) throw new Error("size");
    return { mime, data };
  });
}

export function MediaLibraryPanel({ token }: { token: string }) {
  const [body, setBody] = useState<LibraryBody | null>(null);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");
  const [name, setName] = useState("");
  const [newCategory, setNewCategory] = useState<(typeof LIBRARY_CATEGORIES)[number]>("Wedding covers");
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [pending, setPending] = useState("");

  function load() {
    void developerLibraryList({ data: { token } }).then(setBody);
  }

  useEffect(() => {
    load();
  }, [token]);

  function afterChange(message: string) {
    setNote(message);
    invalidateLibrary();
    load();
  }

  function upload(file: File, mode: { kind: "new" } | { kind: "replace"; id: string }) {
    const key = mode.kind === "new" ? "upload" : mode.id;
    setBusy(key);
    setProgress(8);
    setNote("");
    void preparePicture(file, (percent) => setProgress(Math.min(85, percent)))
      .then((picture) => {
        setProgress(92);
        if (mode.kind === "new") {
          return developerLibraryCreate({ data: { token, name, category: newCategory, ...picture } });
        }
        return developerLibraryReplace({ data: { token, id: mode.id, ...picture } });
      })
      .then((result) => {
        if (!result.ok) setNote(result.error);
        else {
          if (mode.kind === "new") setName("");
          afterChange(mode.kind === "new" ? "The picture is in the library." : "The picture was replaced. Circles that already use it keep the same picture id.");
        }
      })
      .catch((error: unknown) => {
        const kind = error instanceof Error ? error.message : "";
        setNote(kind === "size" ? "That picture is too large. Try a smaller JPEG, PNG or WebP." : "Use a JPEG, PNG or WebP from your device.");
      })
      .finally(() => {
        setBusy("");
        setProgress(null);
      });
  }

  if (!body) return <p>Loading the media library…</p>;
  if (!body.ok) return <p>{body.error}</p>;

  const filtered = body.assets.filter((item) => {
    const hay = `${item.name} ${item.id} ${item.path}`.toLowerCase();
    if (query.trim() && !hay.includes(query.trim().toLowerCase())) return false;
    if (category !== "All" && item.category !== category) return false;
    if (status === "Active" && !item.active) return false;
    if (status === "Inactive" && item.active) return false;
    return true;
  });

  return (
    <section>
      <h1 className="font-serif text-4xl">Developer Media Library</h1>
      <p className="mt-2 max-w-2xl text-sm text-on-photo/70">{body.note}</p>
      <SampleCoverEditor token={token} />
      <form
        className="mt-6 rounded-card border border-on-photo/10 p-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          if (name.trim().length < 2) {
            setNote("Give the picture a name.");
            return;
          }
          const input = event.currentTarget.elements.namedItem("library-file");
          const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
          if (!file) {
            setNote("Choose a picture from your device.");
            return;
          }
          upload(file, { kind: "new" });
          input instanceof HTMLInputElement && (input.value = "");
        }}
      >
        <h2 className="font-serif text-2xl">Upload new image</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-on-photo/70">Name</span>
            <input className="mt-1 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3" value={name} onChange={(event) => setName(event.target.value)} placeholder="Floral gold" />
          </label>
          <label className="text-sm">
            <span className="text-on-photo/70">Category</span>
            <select className="mt-1 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3" value={newCategory} onChange={(event) => setNewCategory(event.target.value as (typeof LIBRARY_CATEGORIES)[number])}>
              {LIBRARY_CATEGORIES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-full border border-on-photo/20 px-4 text-sm">
          Choose from gallery
          <input name="library-file" type="file" accept={ACCEPT} className="sr-only" />
        </label>
        <button type="submit" disabled={Boolean(busy)} className="ml-2 min-h-11 rounded-full bg-maroon px-4 text-sm">
          {busy === "upload" ? "Uploading…" : "Upload image"}
        </button>
        {progress !== null ? (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-on-photo/10">
              <div className="h-full bg-gold" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-xs text-on-photo/60">{progress < 90 ? `Preparing ${progress}%` : "Saving…"}</p>
          </div>
        ) : null}
      </form>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="sr-only">Search</span>
          <input className="w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or id" />
        </label>
        <label className="text-sm">
          <span className="sr-only">Category</span>
          <select className="w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="All">All categories</option>
            {LIBRARY_CATEGORIES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="sr-only">Status</span>
          <select className="w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="All">Active and inactive</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </label>
      </div>
      {note ? <p className="mt-4 text-sm text-gold">{note}</p> : null}
      <ul className="mt-4 grid gap-4 lg:grid-cols-2">
        {filtered.length === 0 ? <li className="text-sm text-on-photo/70">No picture matches.</li> : null}
        {filtered.map((item) => (
          <LibraryCard
            key={item.id}
            item={item}
            token={token}
            busy={busy}
            pending={pending === item.id}
            onPending={setPending}
            onUpload={(file) => upload(file, { kind: "replace", id: item.id })}
            onNote={setNote}
            onChanged={afterChange}
          />
        ))}
      </ul>
    </section>
  );
}

function SampleCoverEditor({ token }: { token: string }) {
  const [cover, setCover] = useState("");
  const [custom, setCustom] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  function load() {
    void developerPublicConfig().then((config) => {
      const next = config.sample?.cover || "";
      setCover(next);
      setCustom(Boolean(next));
    });
  }

  useEffect(() => {
    load();
  }, [token]);

  function upload(file: File) {
    setBusy(true);
    setProgress(8);
    setNote("");
    void preparePicture(file, (percent) => setProgress(Math.min(85, percent)))
      .then((picture) => {
        setProgress(92);
        return developerSampleCoverSave({ data: { token, ...picture } });
      })
      .then((result) => {
        if (!result.ok) setNote(result.error);
        else {
          setCover(result.cover);
          setCustom(true);
          setConfirm(false);
          invalidateLibrary();
          setNote("The sample wedding cover is updated. Logged-out visitors see this photo.");
        }
      })
      .catch((error: unknown) => {
        const kind = error instanceof Error ? error.message : "";
        setNote(kind === "size" ? "That picture is too large. Try a smaller JPEG, PNG or WebP." : "Use a JPEG, PNG or WebP from your device.");
      })
      .finally(() => {
        setBusy(false);
        setProgress(null);
      });
  }

  return (
    <div className="mt-6 rounded-card border border-on-photo/10 p-4">
      <h2 className="font-serif text-2xl">Sample wedding cover</h2>
      <p className="mt-2 max-w-2xl text-sm text-on-photo/70">
        This is the photo on Nico & Lila for anyone who is logged out. Upload a new one, or remove the custom photo to go back to the built-in ceremony picture.
      </p>
      <LibraryPhoto src={visibleCover(cover)} alt="Sample wedding cover" className="mt-4 h-52 w-full max-w-xl rounded-2xl object-cover" />
      <p className="mt-2 text-xs text-on-photo/50">{custom ? "Custom cover" : "Built-in ceremony photo"}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-maroon px-4 text-sm">
          {busy ? "Saving cover…" : custom ? "Change cover" : "Upload cover"}
          <input
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload(file);
            }}
          />
        </label>
        {custom && !confirm ? (
          <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => setConfirm(true)}>
            Remove cover
          </button>
        ) : null}
        {confirm ? (
          <>
            <button
              type="button"
              className="min-h-11 rounded-full bg-maroon px-4 text-sm"
              onClick={() => {
                setBusy(true);
                setNote("");
                void developerSampleCoverClear({ data: { token, confirm: true } })
                  .then((result) => {
                    if (!result.ok) setNote(result.error);
                    else {
                      setCover("");
                      setCustom(false);
                      setConfirm(false);
                      invalidateLibrary();
                      setNote("Custom cover removed. The sample wedding uses the ceremony photo again.");
                    }
                  })
                  .finally(() => setBusy(false));
              }}
            >
              Confirm remove
            </button>
            <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </>
        ) : null}
      </div>
      {progress !== null ? (
        <div className="mt-3 max-w-xl">
          <div className="h-1.5 overflow-hidden rounded-full bg-on-photo/10">
            <div className="h-full bg-gold" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-on-photo/60">{progress < 90 ? `Preparing ${progress}%` : "Saving…"}</p>
        </div>
      ) : null}
      {note ? <p className="mt-3 text-sm text-gold">{note}</p> : null}
    </div>
  );
}

function LibraryCard({
  item,
  token,
  busy,
  pending,
  onPending,
  onUpload,
  onNote,
  onChanged,
}: {
  item: Asset;
  token: string;
  busy: string;
  pending: boolean;
  onPending: (id: string) => void;
  onUpload: (file: File) => void;
  onNote: (message: string) => void;
  onChanged: (message: string) => void;
}) {
  const [label, setLabel] = useState(item.name);
  const [category, setCategory] = useState(item.category);
  useEffect(() => {
    setLabel(item.name);
    setCategory(item.category);
  }, [item.name, item.category]);

  return (
    <li className="rounded-card border border-on-photo/10 p-4 text-sm">
      <img src={item.src} alt={item.name} className="h-40 w-full rounded-2xl object-cover" />
      <p className="mt-3 font-serif text-2xl">{item.name}</p>
      <p className="mt-1 text-on-photo/70">
        {item.builtin ? "Built-in" : "Added"} · {item.active ? "Active" : "Inactive"} · {item.category}
      </p>
      <p className="mt-1 break-all text-xs text-on-photo/50">{item.id}</p>
      <p className="mt-2">Used by {item.circles} published circle{item.circles === 1 ? "" : "s"}</p>
      <p className="text-on-photo/70">Used on: {item.places.join(", ") || "Library only"}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <input className="rounded-2xl border border-on-photo/20 bg-ink px-3 py-2" value={label} onChange={(event) => setLabel(event.target.value)} aria-label={`Name for ${item.name}`} />
        <select className="rounded-2xl border border-on-photo/20 bg-ink px-3 py-2" value={category} onChange={(event) => setCategory(event.target.value)} aria-label={`Category for ${item.name}`}>
          {LIBRARY_CATEGORIES.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 rounded-full border border-on-photo/20 px-4"
          onClick={() => {
            void developerLibraryRename({ data: { token, id: item.id, name: label, category } }).then((result) => {
              if (!result.ok) onNote(result.error);
              else onChanged("Name and category saved.");
            });
          }}
        >
          Save details
        </button>
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-on-photo/20 px-4">
          {busy === item.id ? "Replacing…" : "Replace"}
          <input
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={Boolean(busy)}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onUpload(file);
            }}
          />
        </label>
        <button
          type="button"
          className="min-h-11 rounded-full border border-on-photo/20 px-4"
          onClick={() => {
            void developerLibraryActive({ data: { token, id: item.id, active: !item.active } }).then((result) => {
              if (!result.ok) onNote(result.error);
              else onChanged(item.active ? "Hidden from new circles. Circles already using it still show it." : "The picture is available again.");
            });
          }}
        >
          {item.active ? "Disable" : "Enable"}
        </button>
        {pending ? (
          item.circles > 0 ? (
            <div className="w-full">
              <p className="text-gold">Used by {item.circles} circles. Delete is blocked so those covers do not break. Disable it if new circles should not see it.</p>
              <button type="button" className="mt-2 min-h-11 rounded-full border border-on-photo/20 px-4" onClick={() => onPending("")}>Close</button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="min-h-11 rounded-full bg-maroon px-4"
                onClick={() => {
                  void developerLibraryDelete({ data: { token, id: item.id, confirm: true } }).then((result) => {
                    if (!result.ok) onNote(result.error);
                    else {
                      onPending("");
                      onChanged(item.builtin ? "Removed from the library. The original file stays for anything still pointing at it." : "The picture was deleted.");
                    }
                  });
                }}
              >
                Confirm delete
              </button>
              <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-4" onClick={() => onPending("")}>Cancel</button>
            </>
          )
        ) : (
          <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-4" onClick={() => onPending(item.id)}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
