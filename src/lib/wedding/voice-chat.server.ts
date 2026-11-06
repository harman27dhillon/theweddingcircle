import { getSql } from "@/lib/db";
import { voiceOn, type VoiceInput } from "./voice-chat.db.ts";
import { realtimeVoiceProvider } from "./voice-realtime.ts";
import { serverEnvironment } from "@/lib/env.server";

export async function runVoice(input: VoiceInput) {
  try {
    const [sql, environment] = await Promise.all([getSql(), serverEnvironment()]);
    return await voiceOn(sql, realtimeVoiceProvider(sql, environment), input);
  } catch {
    console.info("[voice] request failed", input.action);
    return { ok: false as const, error: "Voice chat could not be reached. Try again.", configured: false };
  }
}
