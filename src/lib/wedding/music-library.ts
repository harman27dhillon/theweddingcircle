/** Developer-managed chat music. No built-in tracks. */

export const MUSIC_LIMIT = 12;
export const MUSIC_MAX_BYTES = 1_800_000;
/** Base64 of a 1.8 MB file is about 2.4 MB. Reject anything larger instead of slicing it. */
export const MUSIC_MAX_BASE64 = 2_500_000;

const MIME: Record<string, string> = {
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/mp4": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "video/mp4": "audio/mp4",
  "audio/wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/ogg": "audio/ogg",
  "application/ogg": "audio/ogg",
  "audio/webm": "audio/webm",
  "video/webm": "audio/webm",
};

const EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  mpeg: "audio/mpeg",
  mp4: "audio/mp4",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  webm: "audio/webm",
};

export function musicMime(mime: string) {
  return MIME[mime.trim().toLowerCase()] ?? null;
}

export function clientMusicMime(name: string, type: string) {
  return musicMime(type) ?? EXT[name.toLowerCase().split(".").pop() || ""] ?? null;
}

export function cleanMusicTitle(value: string) {
  const title = value.trim().replace(/\s+/g, " ").slice(0, 80);
  return title.length >= 1 ? title : "";
}

function looksLikeAudio(bytes: Buffer, mime: string) {
  if (bytes.length < 12) return false;
  if (mime === "audio/wav") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE";
  if (mime === "audio/ogg") return bytes.subarray(0, 4).toString("ascii") === "OggS";
  if (mime === "audio/webm") return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (mime === "audio/mpeg") {
    if (bytes.subarray(0, 3).toString("ascii") === "ID3") return true;
    return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  }
  if (mime === "audio/mp4") return bytes.subarray(4, 8).toString("ascii") === "ftyp";
  return false;
}

export function cleanMusicData(mime: string, data: string): { mime: string; data: string; bytes: number } | { error: string } {
  const clean = musicMime(mime);
  if (!clean) return { error: "Use an MP3, M4A, WAV, OGG, or WebM file." };
  if (typeof data !== "string" || data.length > MUSIC_MAX_BASE64) return { error: "Keep each track under 1.8 MB." };
  const payload = data.replace(/\s/g, "");
  if (!payload || payload.length > MUSIC_MAX_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(payload)) {
    return { error: "That audio file could not be read." };
  }
  const bytes = Buffer.from(payload, "base64");
  if (bytes.length < 32 || bytes.length > MUSIC_MAX_BYTES) return { error: "Keep each track under 1.8 MB." };
  if (!looksLikeAudio(bytes, clean)) return { error: "That file is not a supported audio track." };
  return { mime: clean, data: payload, bytes: bytes.length };
}
