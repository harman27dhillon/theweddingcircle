import { mediaObjectKey } from "./media-policy.ts";

export const RECORDING_COPY_LIMIT = 180 * 1024 * 1024;

export function recordingObjectKey(slug: string, recordingId: string) {
  const id = recordingId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32);
  return mediaObjectKey(slug, "chat", "ceremony.mp4", id || "recording");
}

export function replayMessage(input: { recordingId: string; ceremonyName: string; objectKey: string; seconds: number | null }) {
  const id = `replay-${input.recordingId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)}`;
  return {
    id,
    author: "Wedding Circle",
    text: `Replay of ${input.ceremonyName.trim().slice(0, 80) || "the ceremony"} is saved for this wedding.`,
    atLabel: "Replay",
    video: `r2:${input.objectKey}`,
    ...(input.seconds && input.seconds > 0 ? { videoSeconds: input.seconds } : {}),
  };
}

type ChatMessage = { id?: string; author?: string; text?: string; atLabel?: string; video?: string; videoSeconds?: number };
type ChatRoom = { id?: string; name?: string; hint?: string; messages?: ChatMessage[] };

export function appendReplay(chats: ChatRoom[] | undefined, message: ChatMessage) {
  const rooms = Array.isArray(chats) ? chats.map((room) => ({
    ...room,
    messages: Array.isArray(room.messages) ? [...room.messages] : [],
  })) : [];
  if (rooms.some((room) => room.messages.some((item) => item.id === message.id))) {
    return { chats: rooms, duplicate: true as const };
  }
  if (!rooms.length) {
    rooms.push({ id: "live", name: "Live", hint: "Ceremony replays stay in this wedding.", messages: [] });
  }
  const first = rooms[0];
  first.messages = [...(first.messages || []), message];
  return { chats: rooms, duplicate: false as const };
}

export function canCopyRecording(bytes: number) {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= RECORDING_COPY_LIMIT;
}
