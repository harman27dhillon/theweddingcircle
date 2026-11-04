import { randomBytes } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { developerSession } from "@/lib/developer/gate.server";
import { MUSIC_LIMIT, cleanMusicData, cleanMusicTitle, musicMime } from "@/lib/wedding/music-library";

const TRACK_ID = /^track-[a-f0-9]{16}$/;

export type MusicTrackRecord = {
  id: string;
  title: string;
  mime: string;
  bytes: number;
  src: string;
};

type TrackRow = {
  track_id: string;
  title: string;
  mime: string;
  bytes: number | string;
  updated_at: unknown;
};

function stamp(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

async function ensureMusic(sql: Sql) {
  await sql`create table if not exists music_tracks (
    track_id text primary key,
    title text not null,
    mime text not null,
    bytes integer not null,
    created_by text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists music_blobs (
    track_id text primary key references music_tracks(track_id) on delete cascade,
    mime text not null,
    data text not null
  )`;
}

function toRecord(row: TrackRow): MusicTrackRecord {
  const updatedAt = stamp(row.updated_at);
  return {
    id: row.track_id,
    title: row.title,
    mime: musicMime(row.mime) || row.mime,
    bytes: Number(row.bytes) || 0,
    src: `/api/music/file/${row.track_id}?v=${encodeURIComponent(updatedAt)}`,
  };
}

async function readRows(sql: Sql) {
  return sql<TrackRow>`
    select track_id, title, mime, bytes, updated_at
    from music_tracks
    order by created_at asc, track_id asc
  `;
}

export async function listMusicTracks() {
  try {
    const sql = await getSql();
    await ensureMusic(sql);
    const rows = await readRows(sql);
    return { ok: true as const, tracks: rows.map(toRecord), limit: MUSIC_LIMIT };
  } catch {
    return {
      ok: false as const,
      error: "The music library could not be opened.",
      tracks: [] as MusicTrackRecord[],
      limit: MUSIC_LIMIT,
    };
  }
}

async function audit(email: string, command: string, result: string) {
  try {
    const sql = await getSql();
    await sql`
      insert into developer_audit (id, email, command, interpretation, level, action, result)
      values (${randomBytes(16).toString("hex")}, ${email}, ${command.slice(0, 2000)}, ${"Background music"}, ${"yellow"}, ${"music"}, ${result.slice(0, 500)})
    `;
  } catch {
    /* A missing audit table must not drop a saved track. */
  }
}

export async function createMusicTrack(token: string, title: string, mime: string, data: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const label = cleanMusicTitle(title);
  if (!label) return { ok: false as const, error: "Give the track a title." };
  const audio = cleanMusicData(mime, data);
  if ("error" in audio) return { ok: false as const, error: audio.error };
  try {
    const sql = await getSql();
    await ensureMusic(sql);
    const countRows = await sql<{ n: number | string }>`select count(*)::int as n from music_tracks`;
    if (Number(countRows[0]?.n ?? 0) >= MUSIC_LIMIT) {
      return { ok: false as const, error: `The library holds ${MUSIC_LIMIT} tracks. Remove one before adding another.` };
    }
    const id = `track-${randomBytes(8).toString("hex")}`;
    await sql`
      insert into music_tracks (track_id, title, mime, bytes, created_by)
      values (${id}, ${label}, ${audio.mime}, ${audio.bytes}, ${session.email})
    `;
    await sql`insert into music_blobs (track_id, mime, data) values (${id}, ${audio.mime}, ${audio.data})`;
    await audit(session.email, `Add music ${label}`, "added");
    return { ok: true as const, id };
  } catch {
    return { ok: false as const, error: "The music library could not be saved." };
  }
}

export async function replaceMusicTrack(token: string, trackId: string, title: string, mime: string, data: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  if (!TRACK_ID.test(trackId)) return { ok: false as const, error: "That track could not be found." };
  const nextTitle = title.trim() ? cleanMusicTitle(title) : "";
  if (title.trim() && !nextTitle) return { ok: false as const, error: "Give the track a title." };
  const hasFile = data.trim().length > 0;
  if (!hasFile && !nextTitle) return { ok: false as const, error: "Choose an audio file or a title." };
  const audio = hasFile ? cleanMusicData(mime, data) : null;
  if (audio && "error" in audio) return { ok: false as const, error: audio.error };
  try {
    const sql = await getSql();
    await ensureMusic(sql);
    const rows = await sql<{ track_id: string }>`select track_id from music_tracks where track_id = ${trackId} limit 1`;
    if (!rows[0]) return { ok: false as const, error: "That track could not be found." };
    if (audio && !("error" in audio)) {
      await sql`
        insert into music_blobs (track_id, mime, data) values (${trackId}, ${audio.mime}, ${audio.data})
        on conflict (track_id) do update set mime = excluded.mime, data = excluded.data
      `;
      if (nextTitle) {
        await sql`update music_tracks set title = ${nextTitle}, mime = ${audio.mime}, bytes = ${audio.bytes}, updated_at = now() where track_id = ${trackId}`;
      } else {
        await sql`update music_tracks set mime = ${audio.mime}, bytes = ${audio.bytes}, updated_at = now() where track_id = ${trackId}`;
      }
    } else if (nextTitle) {
      await sql`update music_tracks set title = ${nextTitle}, updated_at = now() where track_id = ${trackId}`;
    }
    await audit(session.email, `Update music ${trackId}`, "replaced");
    return { ok: true as const, id: trackId };
  } catch {
    return { ok: false as const, error: "The music library could not be saved." };
  }
}

export async function deleteMusicTrack(token: string, trackId: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  if (!TRACK_ID.test(trackId)) return { ok: false as const, error: "That track could not be found." };
  try {
    const sql = await getSql();
    await ensureMusic(sql);
    const rows = await sql<{ title: string }>`delete from music_tracks where track_id = ${trackId} returning title`;
    if (!rows[0]) return { ok: false as const, error: "That track could not be found." };
    await audit(session.email, `Remove music ${rows[0].title}`, "deleted");
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "The music library could not be saved." };
  }
}

export async function readMusicFile(trackId: string) {
  if (!TRACK_ID.test(trackId)) return null;
  try {
    const sql = await getSql();
    await ensureMusic(sql);
    const rows = await sql<{ data: string; mime: string }>`
      select data, mime from music_blobs where track_id = ${trackId} limit 1
    `;
    const row = rows[0];
    const mime = row ? musicMime(row.mime) : null;
    if (!row?.data || !mime) return null;
    return { bytes: Buffer.from(row.data, "base64"), mime };
  } catch {
    return null;
  }
}
