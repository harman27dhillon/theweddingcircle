import { getSql } from "@/lib/db";
import { voiceOn, type VoiceInput } from "./voice-chat.db.ts";
import { liveKitProvider } from "./voice-livekit.ts";

export async function runVoice(input: VoiceInput) {
  try {
    const sql = await getSql();
    return await voiceOn(sql, liveKitProvider(), input, Date.now());
  } catch {
    console.info("[voice] request failed", input.action);
    return { ok: false as const, error: "Voice chat could not be reached. Try again.", configured: false };
  }
}
