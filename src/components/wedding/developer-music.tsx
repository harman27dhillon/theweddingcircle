import { useEffect, useState, type FormEvent } from "react";
import { developerMusicCreate, developerMusicDelete, developerMusicList, developerMusicReplace } from "@/lib/wedding/music.functions";
import { MUSIC_LIMIT, MUSIC_MAX_BYTES, clientMusicMime } from "@/lib/wedding/music-library";

type MusicBody = Awaited<ReturnType<typeof developerMusicList>>;
type Track = Extract<MusicBody, { ok: true }>["tracks"][number];

const ACCEPT = "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,audio/webm,.mp3,.m4a,.mp4,.wav,.ogg,.webm";

function readAudio(file: File) {
  const mime = clientMusicMime(file.name, file.type);
  if (!mime) return Promise.reject(new Error("Use an MP3, M4A, WAV, OGG, or WebM file."));
  if (file.size > MUSIC_MAX_BYTES) return Promise.reject(new Error("Keep each track under 1.8 MB."));
  return new Promise<{ mime: string; data: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      const data = comma >= 0 ? result.slice(comma + 1) : "";
      if (!data) {
        reject(new Error("That audio file could not be read."));
        return;
      }
      resolve({ mime, data });
    };
    reader.onerror = () => reject(new Error("That audio file could not be read."));
    reader.readAsDataURL(file);
  });
}

export function DeveloperMusicPanel({ token }: { token: string }) {
  const [body, setBody] = useState<MusicBody | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const tracks = body && body.ok ? body.tracks : [];
  const full = tracks.length >= MUSIC_LIMIT;

  function load() {
    void developerMusicList({ data: { token } }).then(setBody);
  }

  useEffect(() => {
    load();
  }, [token]);

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file");
    if (!(file instanceof File) || file.size === 0) {
      setNote("Choose an audio file.");
      return;
    }
    setBusy("new");
    setNote("");
    void readAudio(file)
      .then((audio) => developerMusicCreate({ data: { token, title, ...audio } }))
      .then((result) => {
        if (!result.ok) setNote(result.error);
        else {
          setTitle("");
          form.reset();
          setNote("The track is in the library.");
          load();
        }
      })
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : "That audio file could not be read."))
      .finally(() => setBusy(""));
  }

  function replace(track: Track, file: File) {
    setBusy(track.id);
    setNote("");
    void readAudio(file)
      .then((audio) => developerMusicReplace({ data: { token, id: track.id, title: "", ...audio } }))
      .then((result) => {
        if (!result.ok) setNote(result.error);
        else {
          setNote("The track was replaced.");
          load();
        }
      })
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : "That audio file could not be read."))
      .finally(() => setBusy(""));
  }

  function rename(track: Track, next: string) {
    setBusy(track.id);
    setNote("");
    void developerMusicReplace({ data: { token, id: track.id, title: next, mime: "", data: "" } })
      .then((result) => {
        if (!result.ok) setNote(result.error);
        else {
          setNote("The title was saved.");
          load();
        }
      })
      .finally(() => setBusy(""));
  }

  function remove(track: Track) {
    setBusy(track.id);
    setNote("");
    void developerMusicDelete({ data: { token, id: track.id } })
      .then((result) => {
        if (!result.ok) setNote(result.error);
        else {
          setNote("The track was removed.");
          load();
        }
      })
      .finally(() => setBusy(""));
  }

  return (
    <section className="max-w-3xl">
      <h1 className="font-serif text-4xl">Background music</h1>
      <p className="mt-3 text-sm text-on-photo/70">
        Tracks you add here play in every wedding chat. Guests can only choose and play them. Nothing is added until you upload it.
      </p>
      {body && !body.ok ? <p className="mt-4 text-sm text-gold">{body.error}</p> : null}
      {note ? <p className="mt-4 text-sm text-gold">{note}</p> : null}
      <form onSubmit={upload} className="mt-6 rounded-card border border-on-photo/15 p-4">
        <p className="text-sm text-gold">{tracks.length} of {MUSIC_LIMIT}</p>
        <label className="mt-3 block text-sm">
          Title
          <input
            className="mt-1 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 outline-none"
            value={title}
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="mt-3 block text-sm">
          Audio file
          <input name="file" type="file" accept={ACCEPT} className="mt-1 block w-full text-sm" />
        </label>
        <p className="mt-2 text-xs text-on-photo/60">MP3, M4A, WAV, OGG, or WebM. Up to 1.8 MB each.</p>
        <button type="submit" disabled={busy === "new" || full} className="mt-4 min-h-11 rounded-full bg-maroon px-4 text-sm text-on-photo disabled:opacity-50">
          {full ? "Library is full" : busy === "new" ? "Adding…" : "Add track"}
        </button>
      </form>
      {tracks.length === 0 ? <p className="mt-6 text-sm text-on-photo/70">No music has been added yet.</p> : null}
      <ul className="mt-6 flex flex-col gap-3">
        {tracks.map((track) => (
          <li key={`${track.id}:${track.title}:${track.src}`} className="rounded-card border border-on-photo/15 p-4">
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const next = new FormData(event.currentTarget).get("title");
                rename(track, typeof next === "string" ? next : track.title);
              }}
            >
              <label className="text-sm">
                Title
                <input name="title" defaultValue={track.title} maxLength={80} className="mt-1 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 outline-none" />
              </label>
              <audio controls preload="none" src={track.src} className="h-10 w-full" />
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy === track.id} className="min-h-11 rounded-full border border-on-photo/25 px-4 text-sm">
                  Save title
                </button>
                <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-on-photo/25 px-4 text-sm">
                  {busy === track.id ? "Working…" : "Replace file"}
                  <input
                    type="file"
                    accept={ACCEPT}
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) replace(track, file);
                    }}
                  />
                </label>
                <button type="button" disabled={busy === track.id} className="min-h-11 rounded-full bg-maroon px-4 text-sm text-on-photo" onClick={() => remove(track)}>
                  Remove
                </button>
              </div>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
